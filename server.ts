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

const PORT = parseInt(args.port);

// --- SSL Setup ---
// Use custom certs via --key/--cert, or auto-generate self-signed
const customKey = args.key || null;
const customCert = args.cert || null;

let sslOptions;

if (customKey && customCert) {
    console.log(`[Server] Using custom SSL cert: ${customCert}`);
    sslOptions = {
        key: fs.readFileSync(customKey),
        cert: fs.readFileSync(customCert)
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

app.get('/api/admin/rooms', (req, res) => {
    const data = [];
    for (const [id, room] of activeRooms.entries()) {
        data.push({
            id,
            clients: room.network.connections.size,
            entities: room.context.managers.entity.entities.size
        });
    }
    res.json(data);
});

app.get('/admin', (req, res) => {
    res.send(`
        <html>
        <head><title>TheHangout Admin</title><style>body { font-family: sans-serif; background: #222; color: #fff; padding: 2em; }</style></head>
        <body>
            <h1>TheHangout Admin Dashboard</h1>
            <div id="rooms">Loading...</div>
            <script>
                async function fetchRooms() {
                    const res = await fetch('/api/admin/rooms');
                    const rooms = await res.json();
                    const el = document.getElementById('rooms');
                    if (rooms.length === 0) el.innerHTML = '<p>No active rooms.</p>';
                    else {
                        el.innerHTML = rooms.map(r => 
                            '<div style="border:1px solid #444; padding:1em; margin-bottom:1em; border-radius: 8px;">' +
                            '<h3 style="margin-top:0; color: #00ffff;">Room: ' + r.id + '</h3>' +
                            '<p>Clients connected: <span style="font-weight:bold;">' + r.clients + '</span> | Entities ticking: <span style="font-weight:bold;">' + r.entities + '</span></p>' +
                            '</div>'
                        ).join('');
                    }
                }
                fetchRooms();
                setInterval(fetchRooms, 2000);
            </script>
        </body>
        </html>
    `);
});

// Serve the built client
const distPath = path.join(__dirname, 'dist');
if (!fs.existsSync(distPath)) {
    console.warn('[Server] Warning: dist/ not found. Run "npm run build" first.');
}
app.use(express.static(distPath));

// --- HTTPS Server (must exist before PeerJS) ---
const server = https.createServer(sslOptions, app);

const peerServer = ExpressPeerServer(server, {
    debug: true,
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
    console.log(`[PeerJS] Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`[PeerJS] Peer disconnected: ${client.getId()}`);
});

peerServer.on('error', (err) => {
    console.error('[PeerJS] Server Error:', err);
});

// --- WebSocket Relay (Fallback for restricted networks) ---
const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false // Disable compression to avoid 'Invalid frame header' in some environments
});
const activeRooms = new Map(); // roomId -> HeadlessRoom

// Take over 'upgrade' handling to ensure strict routing between PeerJS and Relay
const originalUpgradeListeners = server.listeners('upgrade').slice();
server.removeAllListeners('upgrade');

server.on('upgrade', (request, socket, head) => {
    try {
        const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
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
    let currentRoomId = null;
    let currentPeerId = null;

    ws.on('message', (message) => {
        try {
            const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());

            if (data.type === 'join') {
                currentRoomId = data.roomId;
                currentPeerId = data.peerId;

                if (!activeRooms.has(currentRoomId)) {
                    const networkMgr = new ServerNetworkManager();
                    const room = new HeadlessRoom(currentRoomId, networkMgr);
                    activeRooms.set(currentRoomId, room);
                    room.start();
                }

                const room = activeRooms.get(currentRoomId);
                room.network.addClient(currentPeerId, ws);
                console.log(`[Relay] Peer ${currentPeerId} joined room ${currentRoomId}`);

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
        .filter(i => i.family === 'IPv4' && !i.internal);

    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║        TheHangout — Local Server         ║');
    console.log('  ╠══════════════════════════════════════════╣');
    console.log(`  ║  Local:   https://localhost:${PORT}/`);
    for (const iface of interfaces) {
        console.log(`  ║  Network: https://${iface.address}:${PORT}/`);
    }
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
});
