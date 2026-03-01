// server.js — Local Node.js server for TheHangout
// Serves the built app + runs PeerJS signaling locally.
//
// Usage:
//   npm run build    # Build the client first
//   npm run serve    # Start this server
//   Open https://localhost:9000

import express from 'express';
import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { ExpressPeerServer } from 'peer';
import { parseArgs } from 'node:util';
import { WebSocketServer, WebSocket } from 'ws';

import { HeadlessRoom } from './src/server/HeadlessRoom.js';
import { ServerNetworkManager } from './src/server/ServerNetworkManager.js';
import { PACKET_TYPES } from './src/utils/Constants.js';
import {
    IDesktopSourcesStatusRequestPayload,
    IDesktopSourcesStatusResponsePayload,
    IDesktopStreamSummonPayload,
    IDesktopStreamStopPayload
} from './src/interfaces/INetworkPacket.js';

const activeRooms = new Map<string, HeadlessRoom>(); // roomId -> HeadlessRoom
const globalDesktopSources = new Map<string, WebSocket>(); // key -> source websocket
const desktopSourceBySocket = new WeakMap<WebSocket, string>(); // source websocket -> key
const desktopRoutes = new Map<string, { roomId: string; name?: string; summonedBy: string; summonerName?: string; anchor?: [number, number, number]; quaternion?: [number, number, number, number] }>(); // key -> route metadata
const capturingKeys = new Set<string>(); // key -> currently broadcasting
const relaySourceSubscriptions = new Map<WebSocket, { roomId: string; keys: Set<string> }>(); // relay ws -> subscribed keys

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI args (with env var fallback) ---
const { values: args } = parseArgs({
    options: {
        port: { type: 'string', short: 'p', default: process.env.PORT || '443' },
        key: { type: 'string', short: 'k', default: process.env.SSL_KEY || '' },
        cert: { type: 'string', short: 'c', default: process.env.SSL_CERT || '' },
    },
    strict: false
});

const PORT = parseInt(args.port as string);

// --- SSL Setup ---
// Use custom certs via --key/--cert, or auto-generate self-signed
const customKey = args.key || null;
const customCert = args.cert || null;

let sslOptions;

if (customKey && customCert) {
    console.log(`[Server] Using custom SSL cert: ${customCert}`);
    sslOptions = {
        key: fs.readFileSync(customKey as string),
        cert: fs.readFileSync(customCert as string)
    };
} else {
    // Auto-generate self-signed cert
    const certDir = path.join(__dirname, '.certs');
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');

    if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir, { recursive: true });
    }

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        console.log('[Server] Generating self-signed SSL certificate via openssl...');
        execSync(
            `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost" -config NUL`,
            { stdio: 'inherit' }
        );
        console.log('[Server] SSL certificate generated.');
    }

    sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    };
}

function sendPacketToRoom(roomId: string, type: number, payload: unknown): void {
    const room = activeRooms.get(roomId);
    if (!room) return;
    const envelope = JSON.stringify({ type, payload });
    for (const ws of room.network.connections.values()) {
        if (ws?.readyState === 1) ws.send(envelope);
    }
}

function sendBinaryToRoom(roomId: string, data: Buffer): void {
    const room = activeRooms.get(roomId);
    if (!room) return;
    for (const ws of room.network.connections.values()) {
        if (ws?.readyState === 1) ws.send(data);
    }
}

function buildSourceStatusPayload(roomId: string, requestedKeys: string[]): IDesktopSourcesStatusResponsePayload {
    const statuses: Record<string, boolean> = {};
    const requestedSet = new Set(requestedKeys);

    // 1. Report online status for anything the client specifically asked about
    for (const key of requestedKeys) {
        statuses[key] = globalDesktopSources.has(key);
    }

    // 2. Identify all keys currently active in THIS room
    const roomActiveKeys: string[] = [];
    const activeNames: Record<string, string> = {};
    const activeSummonerNames: Record<string, string> = {};

    for (const [key, route] of desktopRoutes.entries()) {
        if (route.roomId === roomId) {
            roomActiveKeys.push(key);
            activeNames[key] = route.name || key;
            activeSummonerNames[key] = route.summonerName || 'Someone';
            // Also ensure online status is reported for these so client knows they're available
            statuses[key] = globalDesktopSources.has(key);
        }
    }

    // 3. Capturing keys (union of requested + room-active)
    const allRelevantKeys = new Set([...requestedKeys, ...roomActiveKeys]);
    const capturing = Array.from(allRelevantKeys).filter(k => capturingKeys.has(k));

    const response = {
        statuses,
        activeKeys: roomActiveKeys,
        capturingKeys: capturing,
        activeNames,
        activeSummonerNames
    };
    return response;
}

function sendSourceStatusToRelayClient(ws: WebSocket, roomId: string, keys: string[]): void {
    if (ws.readyState !== 1) return;
    const payload = buildSourceStatusPayload(roomId, keys);
    ws.send(JSON.stringify({
        type: PACKET_TYPES.DESKTOP_SOURCES_STATUS_RESPONSE,
        payload
    }));
}

function notifySubscribedClientsForKey(key: string): void {
    const route = desktopRoutes.get(key);
    const isWatched = !!route; // If it has a route, it's summoned in a room

    // 1. Notify the source itself about its watch status
    const sourceWs = globalDesktopSources.get(key);
    if (sourceWs && sourceWs.readyState === 1) {
        sourceWs.send(JSON.stringify({
            type: 'watch-status',
            key,
            isWatched
        }));
    }

    // 2. Notify relay clients (the UI)
    for (const [ws, sub] of relaySourceSubscriptions.entries()) {
        const isRequested = sub.keys.has(key);
        const isInRoom = route && route.roomId === sub.roomId;

        if (isRequested || isInRoom) {
            sendSourceStatusToRelayClient(ws, sub.roomId, Array.from(sub.keys));
        }
    }
}

function stopRoutedStreamsForRoom(roomId: string): void {
    for (const [key, route] of Array.from(desktopRoutes.entries())) {
        if (route.roomId !== roomId) continue;
        desktopRoutes.delete(key);
        notifySubscribedClientsForKey(key);
    }
}

// --- Express App ---
const app = express();

// API: Server info endpoint for client auto-detection
app.get('/api/server-info', (req, res) => {
    res.json({
        local: true,
        peerPath: '/peerjs',
        version: process.env.npm_package_version || '1.0.0alpha'
    });
});

app.use(express.json());

app.get('/api/admin/rooms', (req, res) => {
    const data = [];
    for (const [id, room] of activeRooms.entries()) {
        data.push(room.getStats());
    }
    res.json(data);
});

app.get('/api/admin/server-stats', (req, res) => {
    const memory = process.memoryUsage();
    const uptime = Math.floor(process.uptime());
    res.json({
        uptime,
        ram: Math.round(memory.rss / 1024 / 1024)
    });
});

app.post('/api/admin/room/:id/command', (req, res) => {
    const { id } = req.params;
    const { command, payload } = req.body;
    const room = activeRooms.get(id);

    if (!room) return res.status(404).json({ error: 'Room not found' });

    console.log(`[Admin] Command received for ${id}: ${command}`, payload);

    switch (command) {
        case 'spawn_cube':
            room.network.spawnCube();
            break;
        case 'reset':
            room.network.resetRoom();
            break;
        case 'broadcast':
            room.network.broadcastNotification(payload || 'System Announcement');
            break;
        default:
            return res.status(400).json({ error: 'Unknown command' });
    }

    res.json({ success: true });
});

// Serve the static admin dashboard files
const adminPath = path.join(__dirname, 'src', 'server', 'admin');
app.use('/admin', express.static(adminPath));

// Serve dedicated desktop sharing page
const sharePath = path.join(__dirname, 'src', 'server', 'share');
app.use('/share', express.static(sharePath));

// Serve the built client
const distPath = path.join(__dirname, 'dist');
if (!fs.existsSync(distPath)) {
    console.warn('[Server] Warning: dist/ not found. Run "npm run build" first.');
}
app.use(express.static(distPath));

// --- HTTPS Server (must exist before PeerJS) ---
const server = https.createServer(sslOptions, app);

const peerServer = ExpressPeerServer(server, {
    path: '/',
    allow_discovery: true,
    // Removing 'proxied: true' for now to debug 'Invalid frame header'
    // as some proxies/environments don't like transformations.
});

app.use('/peerjs', peerServer);

// SPA fallback — Express 5 requires named catch-all parameter
app.get('{*path}', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

peerServer.on('connection', (client) => {
    console.log(`[PeerJS] Peer connected: ${client.getId()} `);
});

peerServer.on('disconnect', (client) => {
    console.log(`[PeerJS] Peer disconnected: ${client.getId()} `);
});

peerServer.on('error', (err) => {
    console.error('[PeerJS] Server Error:', err);
});

// --- WebSocket Relay (Fallback for restricted networks) ---
const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false // Disable compression to avoid 'Invalid frame header' in some environments
});

const desktopSourceWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false
});

// Take over 'upgrade' handling to ensure strict routing between PeerJS and Relay
const originalUpgradeListeners = server.listeners('upgrade').slice();
server.removeAllListeners('upgrade');

server.on('upgrade', (request, socket, head) => {
    try {
        const url = new URL(request.url || '', `https://${request.headers.host || 'localhost'}`);
        const pathname = url.pathname;
        console.log(`[Server] Upgrade Request: ${pathname}`);

        if (pathname === '/relay') {
            console.log('[Server] Routing to Relay...');
            wss.handleUpgrade(request, socket, head, (ws) => {
                console.log('[Server] Relay Handshake Complete');
                wss.emit('connection', ws, request);
            });
        } else if (pathname === '/desktop-source') {
            console.log('[Server] Routing to Desktop Source...');
            desktopSourceWss.handleUpgrade(request, socket, head, (ws) => {
                console.log('[Server] Desktop Source Handshake Complete');
                desktopSourceWss.emit('connection', ws, request);
            });
        } else {
            // Pass to PeerJS or other listeners
            if (originalUpgradeListeners.length > 0) {
                originalUpgradeListeners.forEach(l => l(request, socket, head));
            } else {
                console.log(`[Server] No handler for upgrade path: ${pathname}`);
                socket.destroy();
            }
        }
    } catch (e) {
        console.error('[Server] Upgrade processing error:', e);
        socket.destroy();
    }
});
wss.on('connection', (ws) => {
    console.log('[Relay] New Connection established');
    let currentRoomId: string | null = null;
    let currentPeerId: string | null = null;
    let currentSubscribedKeys: Set<string> = new Set();

    ws.on('message', (message) => {
        try {
            const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());

            if (data.type === 'join') {
                currentRoomId = data.roomId;
                currentPeerId = data.peerId;

                if (!currentRoomId || !currentPeerId) return;

                if (!activeRooms.has(currentRoomId)) {
                    const networkMgr = new ServerNetworkManager();
                    const room = new HeadlessRoom(currentRoomId, networkMgr);
                    activeRooms.set(currentRoomId, room);
                    room.start();
                }

                const room = activeRooms.get(currentRoomId);
                if (room) {
                    room.network.addClient(currentPeerId, ws);
                    console.log(`[Relay] Peer ${currentPeerId} joined room ${currentRoomId}`);
                }

            } else {
                if (currentRoomId && currentPeerId) {
                    if (data.type === PACKET_TYPES.DESKTOP_SOURCES_STATUS_REQUEST) {
                        const payload = (data.payload || {}) as IDesktopSourcesStatusRequestPayload;
                        const keys = Array.isArray(payload.keys)
                            ? payload.keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
                            : [];
                        currentSubscribedKeys = new Set(keys);
                        relaySourceSubscriptions.set(ws, {
                            roomId: currentRoomId,
                            keys: currentSubscribedKeys
                        });

                        sendSourceStatusToRelayClient(ws, currentRoomId, keys);
                        return;
                    }

                    if (data.type === PACKET_TYPES.DESKTOP_STREAM_SUMMON) {
                        const payload = (data.payload || {}) as IDesktopStreamSummonPayload;
                        const key = typeof payload.key === 'string' ? payload.key.trim() : '';
                        if (!key) return;

                        const sourceWs = globalDesktopSources.get(key);
                        if (!sourceWs || sourceWs.readyState !== 1) {
                            sendPacketToRoom(currentRoomId, PACKET_TYPES.DESKTOP_STREAM_OFFLINE, {
                                key,
                                roomId: currentRoomId
                            });
                            return;
                        }

                        // Allow summoning non-capturing online sources
                        // if (!capturingKeys.has(key)) {
                        //     // Source not yet broadcasting
                        //     return;
                        // }

                        desktopRoutes.set(key, {
                            roomId: currentRoomId,
                            name: payload.name,
                            summonedBy: currentPeerId,
                            summonerName: payload.summonerName || 'Someone',
                            anchor: payload.anchor,
                            quaternion: payload.quaternion
                        });
                        notifySubscribedClientsForKey(key);

                        sendPacketToRoom(currentRoomId, PACKET_TYPES.DESKTOP_STREAM_SUMMONED, {
                            key,
                            name: payload.name,
                            roomId: currentRoomId,
                            anchor: payload.anchor,
                            quaternion: payload.quaternion,
                            summonedByPeerId: currentPeerId,
                            summonedByName: payload.summonerName || 'Someone'
                        });

                        sendPacketToRoom(currentRoomId, PACKET_TYPES.ROOM_NOTIFICATION, {
                            kind: 'desktop_stream_started',
                            actorPeerId: currentPeerId,
                            actorName: payload.name || 'Someone',
                            subjectName: payload.name || key,
                            sentAt: Date.now()
                        });
                        return;
                    }

                    if (data.type === PACKET_TYPES.DESKTOP_STREAM_STOP) {
                        const payload = (data.payload || {}) as IDesktopStreamStopPayload;
                        const key = typeof payload.key === 'string' ? payload.key.trim() : '';
                        if (!key) return;
                        const route = desktopRoutes.get(key);
                        if (!route || route.roomId !== currentRoomId) return;

                        desktopRoutes.delete(key);
                        notifySubscribedClientsForKey(key);
                        sendPacketToRoom(currentRoomId, PACKET_TYPES.DESKTOP_STREAM_STOPPED, {
                            key,
                            roomId: currentRoomId
                        });

                        sendPacketToRoom(currentRoomId, PACKET_TYPES.ROOM_NOTIFICATION, {
                            kind: 'desktop_stream_stopped',
                            actorPeerId: currentPeerId,
                            subjectName: route?.name || key,
                            sentAt: Date.now()
                        });
                        return;
                    }

                    const room = activeRooms.get(currentRoomId);
                    if (room) {
                        room.network.handleMessage(currentPeerId, data);
                    }
                }
            }
        } catch (e) {
            console.error('[Relay] Error processing message:', e);
        }
    });

    ws.on('close', () => {
        relaySourceSubscriptions.delete(ws);

        // Auto-Cleanup Desktop Streams owned by this peer
        if (currentPeerId && currentRoomId) {
            for (const [key, route] of desktopRoutes.entries()) {
                if (route.summonedBy === currentPeerId && route.roomId === currentRoomId) {
                    desktopRoutes.delete(key);
                    notifySubscribedClientsForKey(key);
                    sendPacketToRoom(currentRoomId, PACKET_TYPES.DESKTOP_STREAM_STOPPED, {
                        key,
                        roomId: currentRoomId
                    });

                    sendPacketToRoom(currentRoomId, PACKET_TYPES.ROOM_NOTIFICATION, {
                        kind: 'desktop_stream_stopped',
                        actorPeerId: 'system',
                        actorName: 'System',
                        subjectName: route.name || key,
                        message: `Screen stopped because the owner left the room.`,
                        sentAt: Date.now()
                    });
                }
            }
        }

        if (currentRoomId && currentPeerId) {
            const room = activeRooms.get(currentRoomId);
            if (room) {
                room.network.removeClient(currentPeerId);
                console.log(`[Relay] Peer ${currentPeerId} left room ${currentRoomId}`);

                if (room.network.connections.size === 0) {
                    stopRoutedStreamsForRoom(currentRoomId);
                    room.stop();
                    activeRooms.delete(currentRoomId);
                    console.log(`[Relay] Closed empty room ${currentRoomId}`);
                }
            }
        }

        ws.on('close', () => {
            relaySourceSubscriptions.delete(ws);
        });
    });
});

desktopSourceWss.on('connection', (ws) => {
    let registeredKey: string | null = null;
    console.log('[DesktopSource] Connection established');

    ws.on('message', (message) => {
        try {
            if (Buffer.isBuffer(message)) {
                const firstByte = message.readUInt8(0);
                if (firstByte === PACKET_TYPES.DESKTOP_STREAM_FRAME) {
                    const keyLen = message.readUInt8(1);
                    const key = message.toString('utf8', 2, 2 + keyLen);

                    // Only relay if this source is currently capturing
                    if (capturingKeys.has(key)) {
                        const route = desktopRoutes.get(key);
                        if (route && route.roomId) {
                            sendBinaryToRoom(route.roomId, message);
                        }
                    }
                    return;
                }
            }

            const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());
            console.log(`[DesktopSource] Received JSON: ${JSON.stringify(data).substring(0, 100)}`);

            if (data.type === 'register-global-source') {
                const nextKey = typeof data.key === 'string' ? data.key.trim() : '';
                if (!nextKey) {
                    ws.send(JSON.stringify({ type: 'source-error', message: 'Missing key' }));
                    return;
                }

                const existingWs = globalDesktopSources.get(nextKey);
                const hadCollision = !!existingWs && existingWs !== ws;
                if (existingWs && existingWs !== ws) {
                    try {
                        existingWs.send(JSON.stringify({ type: 'source-error', message: 'Replaced by a new source with same key' }));
                        existingWs.close();
                    } catch { }
                }

                if (registeredKey && registeredKey !== nextKey) {
                    globalDesktopSources.delete(registeredKey);
                    notifySubscribedClientsForKey(registeredKey);
                }

                registeredKey = nextKey;
                globalDesktopSources.set(nextKey, ws);
                desktopSourceBySocket.set(ws, nextKey);

                console.log(`[DesktopSource] Registered "${nextKey}". Total sources: ${globalDesktopSources.size}`);
                notifySubscribedClientsForKey(nextKey);

                ws.send(JSON.stringify({
                    type: 'source-registered',
                    key: nextKey,
                    collision: hadCollision
                }));
                return;
            }

            if (data.type === 'source-capture-started') {
                const key = typeof data.key === 'string' ? data.key.trim() : '';
                if (!key) return;
                console.log(`[DesktopSource] Capture STARTED for "${key}"`);
                capturingKeys.add(key);
                notifySubscribedClientsForKey(key);
                return;
            }

            if (data.type === 'source-frame') {
                const key = typeof data.key === 'string' ? data.key.trim() : '';
                if (!key) return;
                const route = desktopRoutes.get(key);
                if (!route) return;
                if (route.roomId && !activeRooms.has(route.roomId)) {
                    desktopRoutes.delete(key);
                    notifySubscribedClientsForKey(key);
                    return;
                }

                sendPacketToRoom(route.roomId, PACKET_TYPES.DESKTOP_STREAM_FRAME, {
                    key,
                    name: route.name || key,
                    roomId: route.roomId,
                    dataUrl: data.dataUrl,
                    width: data.width,
                    height: data.height,
                    ts: data.ts || Date.now(),
                    anchor: route.anchor,
                    quaternion: route.quaternion
                });
                return;
            }

            if (data.type === 'source-capture-stopped') {
                const key = typeof data.key === 'string' ? data.key.trim() : '';
                if (!key) return;
                capturingKeys.delete(key);
                notifySubscribedClientsForKey(key);

                const route = desktopRoutes.get(key);
                if (route) {
                    sendPacketToRoom(route.roomId, PACKET_TYPES.ROOM_NOTIFICATION, {
                        kind: 'desktop_stream_stopped',
                        subjectName: route.name || key,
                        sentAt: Date.now()
                    });
                }
                return;
            }
        } catch (e) {
            console.error('[DesktopSource] Error processing message:', e);
        }
    });

    ws.on('close', () => {
        const key = registeredKey || desktopSourceBySocket.get(ws) || null;
        if (key) {
            console.log(`[DesktopSource] Connection CLOSED for "${key}"`);
        } else {
            console.log('[DesktopSource] Anonymous connection CLOSED');
        }

        if (!key) return;

        if (globalDesktopSources.get(key) === ws) {
            globalDesktopSources.delete(key);
            capturingKeys.delete(key);
        }
        desktopSourceBySocket.delete(ws);
        notifySubscribedClientsForKey(key);

        const route = desktopRoutes.get(key);
        if (route) {
            desktopRoutes.delete(key);
            notifySubscribedClientsForKey(key);
            sendPacketToRoom(route.roomId, PACKET_TYPES.DESKTOP_STREAM_OFFLINE, {
                key,
                roomId: route.roomId
            });

            sendPacketToRoom(route.roomId, PACKET_TYPES.ROOM_NOTIFICATION, {
                kind: 'desktop_stream_offline',
                subjectName: route.name || key,
                sentAt: Date.now()
            });
        }
        console.log(`[DesktopSource] Disconnected source ${key}`);
    });
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
    const interfaces = Object.values(os.networkInterfaces())
        .flat()
        .filter((i: any) => i && i.family === 'IPv4' && !i.internal);

    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║        TheHangout — Local Server         ║');
    console.log('  ╠══════════════════════════════════════════╣');
    console.log(`  ║  Local:   https://localhost:${PORT}/`);
    for (const iface of interfaces) {
        if (iface) console.log(`  ║  Network: https://${iface.address}:${PORT}/`);
    }
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
});
