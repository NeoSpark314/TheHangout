// dedicatedServer.ts — Local Node.js server for TheHangout
import express from 'express';
import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ExpressPeerServer } from 'peer';
import { parseArgs } from 'node:util';
import { WebSocketServer } from 'ws';
import { getCertificate } from '@vitejs/plugin-basic-ssl';

import { HeadlessSession } from './src/server/HeadlessSession.ts';
import { DedicatedSessionTransport } from './src/server/DedicatedSessionTransport.ts';
import { AssetController } from './src/server/assets/AssetController.ts';
import { DesktopRelayManager } from './src/server/DesktopRelayManager.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const activeSessions = new Map<string, HeadlessSession>();

// --- CLI args ---
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
async function resolveSslOptions(): Promise<https.ServerOptions> {
    if (args.key && args.cert) {
        return {
            key: fs.readFileSync(args.key as string),
            cert: fs.readFileSync(args.cert as string)
        };
    }
    const certDir = path.join(__dirname, 'node_modules', '.vite', 'basic-ssl');
    const pem = await getCertificate(certDir);
    return { key: pem, cert: pem };
}

const sslOptions = await resolveSslOptions();

// --- Helpers ---
function sendPacketToSession(sessionId: string, type: number, payload: unknown): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    const envelope = JSON.stringify({ type, payload });
    for (const ws of session.network.connections.values()) {
        if (ws?.readyState === 1) ws.send(envelope);
    }
}

function sendBinaryToSession(sessionId: string, data: Buffer): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    for (const ws of session.network.connections.values()) {
        if (ws?.readyState === 1) ws.send(data);
    }
}

// --- Managers ---
const relayManager = new DesktopRelayManager(activeSessions, sendPacketToSession, sendBinaryToSession);
const assetController = new AssetController(__dirname);

// --- Express App ---
const app = express();
app.use(express.json());

// API: Server info
app.get('/api/server-info', (req, res) => {
    res.json({ local: true, peerPath: '/peerjs', version: process.env.npm_package_version || '1.0.0' });
});

// Admin API
app.get('/api/admin/sessions', (req, res) => {
    res.json(Array.from(activeSessions.values()).map(s => s.getStats()));
});

app.get('/api/admin/server-stats', (req, res) => {
    res.json({ uptime: Math.floor(process.uptime()), ram: Math.round(process.memoryUsage().rss / 1024 / 1024) });
});

app.post('/api/admin/session/:id/command', (req, res) => {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { command, payload } = req.body;
    if (command === 'switch_scenario') {
        const scenarioId = typeof payload === 'string' ? payload : payload?.scenarioId;
        session.network.requestSessionConfigUpdate({ activeScenarioId: scenarioId });
    } else if (command === 'broadcast') {
        session.network.broadcastNotification(payload || 'System Announcement');
    }
    res.json({ success: true });
});

// Controllers
assetController.register(app);

// Static Serving
app.use('/admin', express.static(path.join(__dirname, 'src', 'server', 'admin')));
app.use('/share', express.static(path.join(__dirname, 'src', 'server', 'share')));
app.use('/server-ui', express.static(path.join(__dirname, 'src', 'server', 'ui')));

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// --- Servers ---
const server = https.createServer(sslOptions, app);

// PeerJS
const peerServer = ExpressPeerServer(server, { path: '/', allow_discovery: true });
app.use('/peerjs', peerServer);

// WebSocket Relay & Desktop Sharing
const wssRelay = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const wssDesktop = new WebSocketServer({ noServer: true, perMessageDeflate: false });

const originalUpgradeListeners = server.listeners('upgrade').slice();
server.removeAllListeners('upgrade');

server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `https://${request.headers.host}`).pathname;
    if (relayManager.handleUpgrade(pathname, request, socket, head, wssRelay, wssDesktop)) return;

    originalUpgradeListeners.forEach(l => l(request, socket, head));
});

wssRelay.on('connection', (ws) => {
    let currentSessionId: string | null = null;
    let currentPeerId: string | null = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message.toString());
        if (data.type === 'join') {
            currentSessionId = data.sessionId;
            currentPeerId = data.peerId;
            if (!activeSessions.has(currentSessionId)) {
                const session = new HeadlessSession(currentSessionId, new DedicatedSessionTransport());
                activeSessions.set(currentSessionId, session);
                session.start();
            }
            activeSessions.get(currentSessionId)?.network.addClient(currentPeerId, ws);
        } else if (currentSessionId && currentPeerId) {
            if (relayManager.handleRelayConnection(ws, currentSessionId, currentPeerId, data)) return;
            activeSessions.get(currentSessionId)?.network.handleMessage(currentPeerId, data);
        }
    });

    ws.on('close', () => {
        if (currentSessionId && currentPeerId) {
            relayManager.handleRelayDisconnect(ws, currentPeerId, currentSessionId);
            const session = activeSessions.get(currentSessionId);
            if (session) {
                session.network.removeClient(currentPeerId);
                if (session.network.connections.size === 0) {
                    relayManager.stopRoutedStreamsForSession(currentSessionId);
                    session.stop();
                    activeSessions.delete(currentSessionId);
                }
            }
        }
    });
});

wssDesktop.on('connection', (ws) => {
    ws.on('message', (msg) => relayManager.handleDesktopSourceMessage(ws, msg));
    ws.on('close', () => relayManager.handleDesktopSourceDisconnect(ws));
});

// SPA Fallback
app.get('{*path}', (req, res) => res.sendFile(path.join(distPath, 'index.html')));

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  TheHangout — Dedicated Server\n  https://localhost:${PORT}/\n`);
});
