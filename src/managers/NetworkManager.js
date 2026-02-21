// managers/NetworkManager.js
import Peer from 'peerjs';
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS, PACKET_TYPES } from '../utils/Constants.js';

export class NetworkManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection

        // Bind events
        eventBus.on(EVENTS.CREATE_ROOM, () => this.initHost());
        eventBus.on(EVENTS.JOIN_ROOM, (roomId) => this.initGuest(roomId));
    }

    initHost() {
        this.peer = new Peer({ debug: 2 });

        this.peer.on('open', (id) => {
            console.log(`[NetworkManager] Host Peer ID: ${id}`);
            gameState.roomId = id;
            eventBus.emit(EVENTS.PEER_CONNECTED, id);
        });

        this.peer.on('connection', (conn) => {
            console.log(`[NetworkManager] Guest connected: ${conn.peer}`);
            this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('[NetworkManager] Host Peer Error:', err);
        });
    }

    initGuest(hostId) {
        this.peer = new Peer({ debug: 2 });

        this.peer.on('open', (id) => {
            console.log(`[NetworkManager] Guest Peer ID: ${id}`);
            gameState.roomId = hostId;

            const conn = this.peer.connect(hostId, { reliable: true });
            this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('[NetworkManager] Guest Peer Error:', err);
        });
    }

    setupConnection(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);

            // If we are guest connecting to host
            if (!gameState.isHost && conn.peer === gameState.roomId) {
                eventBus.emit(EVENTS.PEER_CONNECTED, conn.peer);
            } else if (gameState.isHost) {
                // Broadcast to others if necessary
            }
        });

        conn.on('data', (data) => {
            this.handleData(conn.peer, data);
        });

        conn.on('close', () => {
            console.log(`[NetworkManager] Connection closed: ${conn.peer}`);
            this.connections.delete(conn.peer);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, conn.peer);
        });

        conn.on('error', (err) => {
            console.error(`[NetworkManager] Connection error with ${conn.peer}:`, err);
        });
    }

    handleData(senderId, data) {
        // Parse JSON or binary depending on what we decide
        // For prototype, we can assume JSON parsing for ease, eventually DataView for binary
        try {
            const parsed = JSON.parse(data);
            eventBus.emit(EVENTS.NETWORK_DATA_RECEIVED, { senderId, data: parsed });
        } catch (e) {
            console.error('[NetworkManager] Failed to parse incoming data', e);
        }
    }

    sendData(targetPeerId, data) {
        const conn = this.connections.get(targetPeerId);
        if (conn && conn.open) {
            conn.send(JSON.stringify(data));
        }
    }

    broadcast(data) {
        const payload = JSON.stringify(data);
        for (const [peerId, conn] of this.connections.entries()) {
            if (conn.open) {
                conn.send(payload);
            }
        }
    }

    update(delta) {
        // Process networking steps if we implement batching
    }
}
