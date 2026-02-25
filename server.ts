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
import { WebSocketServer } from 'ws';

import { HeadlessRoom } from './src/server/HeadlessRoom.js';
import { ServerNetworkManager } from './src/server/ServerNetworkManager.js';

const activeRooms = new Map<string, HeadlessRoom>(); // roomId -> HeadlessRoom

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
        if (currentRoomId && currentPeerId) {
            const room = activeRooms.get(currentRoomId);
            if (room) {
                room.network.removeClient(currentPeerId);
                console.log(`[Relay] Peer ${currentPeerId} left room ${currentRoomId}`);

                if (room.network.connections.size === 0) {
                    room.stop();
                    activeRooms.delete(currentRoomId);
                    console.log(`[Relay] Closed empty room ${currentRoomId}`);
                }
            }
        }
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
