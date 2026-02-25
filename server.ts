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

app.get('/admin', (req, res) => {
    const memory = process.memoryUsage();
    const uptime = Math.floor(process.uptime());

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>TheHangout Admin — Dashboard</title>
            <style>
                :root {
                    --bg: #0b0c10;
                    --card: #1f2833;
                    --text: #c5c6c7;
                    --primary: #66fcf1;
                    --secondary: #45a29e;
                    --danger: #ff4c4c;
                }
                body { 
                    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
                    background: var(--bg); 
                    color: var(--text); 
                    margin: 0; 
                    padding: 20px; 
                }
                .container { max-width: 1200px; margin: 0 auto; }
                header { 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    border-bottom: 2px solid var(--card);
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                }
                h1 { margin: 0; color: var(--primary); font-weight: 300; letter-spacing: 2px; }
                .server-stats { display: flex; gap: 20px; font-size: 0.9em; opacity: 0.8; }
                .room-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; }
                .room-card { 
                    background: var(--card); 
                    border-radius: 12px; 
                    padding: 24px; 
                    border: 1px solid #333;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                }
                .room-id { color: var(--primary); font-size: 1.4em; margin-bottom: 15px; display: block; }
                .stat-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.95em; }
                .stat-label { opacity: 0.6; }
                .stat-value { font-weight: 600; color: #fff; }
                
                .controls { margin-top: 20px; display: flex; flex-wrap: wrap; gap: 10px; border-top: 1px solid #333; padding-top: 15px; }
                button { 
                    background: #333; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; 
                    cursor: pointer; font-size: 0.85em; transition: all 0.2s; 
                }
                button:hover { background: #444; color: var(--primary); }
                button.primary { background: var(--secondary); }
                button.danger { background: #551a1a; }
                button.danger:hover { background: var(--danger); }
                
                .broadcast-group { display: flex; gap: 5px; width: 100%; margin-top: 10px; }
                .broadcast-group input { 
                    flex: 1; background: #111; border: 1px solid #333; color: #fff; 
                    padding: 8px; border-radius: 6px; font-size: 0.85em;
                }
                
                .tag { font-size: 0.7em; background: #333; padding: 2px 6px; border-radius: 4px; margin-right: 4px; }
            </style>
        </head>
        <body>
            <div class="container">
                <header>
                    <h1>TH_ADMIN <span style="font-size: 0.5em; opacity: 0.5;">v1.0-headless</span></h1>
                    <div class="server-stats">
                        <div>UPTIME: <span id="server-uptime">${uptime}s</span></div>
                        <div>RAM: <span>${Math.round(memory.rss / 1024 / 1024)}MB</span></div>
                    </div>
                </header>
                
                <div id="rooms" class="room-grid">Loading active sessions...</div>
            </div>

            <script>
                async function sendCommand(roomId, command, payload = null) {
                    try {
                        const res = await fetch(\`/api/admin/room/\${roomId}/command\`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ command, payload })
                        });
                        const data = await res.json();
                        if (data.success) {
                            console.log('Command successful');
                            fetchRooms();
                        }
                    } catch (e) { console.error(e); }
                }

                async function fetchRooms() {
                    const res = await fetch('/api/admin/rooms');
                    const rooms = await res.json();
                    const el = document.getElementById('rooms');
                    
                    if (rooms.length === 0) {
                        el.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px; opacity: 0.5;">NO ACTIVE SESSIONS</div>';
                        return;
                    }

                    el.innerHTML = rooms.map(r => \`
                        <div class="room-card">
                            <span class="room-id">\${r.id}</span>
                            <div class="stat-row">
                                <span class="stat-label">Uptime</span>
                                <span class="stat-value">\${r.uptime}s</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Clients</span>
                                <span class="stat-value">\${r.clients}</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Entities</span>
                                <span class="stat-value">\${r.entityCount} (\${r.entityBreakdown.players}P / \${r.entityBreakdown.props}E)</span>
                            </div>
                            <div class="stat-row">
                                <span class="stat-label">Physics</span>
                                <span class="stat-value">\${r.physics.bodies} bodies / \${r.physics.colliders} colliders</span>
                            </div>
                            
                            <div style="margin-top: 10px; font-size: 0.8em;">
                                <span class="stat-label">Peers:</span> 
                                <div style="margin-top: 5px;">
                                    \${r.peerIds.map(p => \`<span class="tag">\${p}</span>\`).join('') || 'None'}
                                </div>
                            </div>

                            <div class="controls">
                                <button onclick="sendCommand('\${r.id}', 'spawn_cube')" class="primary">Spawn Cube</button>
                                <button onclick="sendCommand('\${r.id}', 'reset')" class="danger">Reset Room</button>
                                
                                <div class="broadcast-group">
                                    <input type="text" id="bc-\${r.id}" placeholder="System message...">
                                    <button onclick="const m = document.getElementById('bc-\${r.id}').value; sendCommand('\${r.id}', 'broadcast', m); document.getElementById('bc-\${r.id}').value=''">Send</button>
                                </div>
                            </div>
                        </div>
                    \`).join('');
                }

                setInterval(fetchRooms, 3000);
                fetchRooms();
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
const activeRooms = new Map(); // roomId -> HeadlessRoom

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
