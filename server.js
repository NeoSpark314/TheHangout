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
    proxied: true // Better handling of corporate proxies/SSL offloading
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
