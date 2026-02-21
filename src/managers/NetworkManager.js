// managers/NetworkManager.js
import Peer from 'peerjs';
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS, PACKET_TYPES } from '../utils/Constants.js';

export class NetworkManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // peerId -> DataConnection

        // Sync Timing (e.g. 20 Hz)
        this.syncRate = 1 / 20;
        this.timeSinceLastSync = 0;

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

            // Dispatch based on packet type
            switch (parsed.type) {
                case PACKET_TYPES.STATE_UPDATE:
                    eventBus.emit(EVENTS.NETWORK_DATA_RECEIVED, { senderId, type: 'STATE', data: parsed.payload });
                    break;
                case PACKET_TYPES.PLAYER_INPUT:
                    eventBus.emit(EVENTS.NETWORK_DATA_RECEIVED, { senderId, type: 'INPUT', data: parsed.payload });
                    break;
                default:
                    console.warn('[NetworkManager] Unknown packet type:', parsed.type);
            }
        } catch (e) {
            console.error('[NetworkManager] Failed to parse incoming data', e);
        }
    }

    sendData(targetPeerId, type, payload) {
        const conn = this.connections.get(targetPeerId);
        if (conn && conn.open) {
            conn.send(JSON.stringify({ type, payload }));
        }
    }

    broadcast(type, payload) {
        const data = JSON.stringify({ type, payload });
        for (const [peerId, conn] of this.connections.entries()) {
            if (conn.open) {
                conn.send(data);
            }
        }
    }

    update(delta) {
        this.timeSinceLastSync += delta;

        if (this.timeSinceLastSync >= this.syncRate) {
            this.timeSinceLastSync = 0;
            this.syncState();
        }
    }

    syncState() {
        // 1. Everyone syncs their LocalPlayer position
        if (gameState.localPlayer && gameState.localPlayer.rigidBody) {
            const pos = gameState.localPlayer.rigidBody.translation();
            const payload = {
                position: { x: pos.x, y: pos.y, z: pos.z },
                yaw: gameState.localPlayer.yaw
            };

            if (gameState.isHost) {
                // Host broadcasts its own input to everyone
                this.broadcast(PACKET_TYPES.PLAYER_INPUT, payload);
            } else if (gameState.roomId) {
                // Guest sends its input only to the Host
                this.sendData(gameState.roomId, PACKET_TYPES.PLAYER_INPUT, payload);
            }
        }

        // 2. Only Host syncs the physics world state
        if (gameState.isHost && gameState.managers.physics) {
            const dynamicBodies = gameState.managers.physics.dynamicBodies;
            const physicsState = [];

            // For simplicity, we send [index, x,y,z, qx,qy,qz,qw]
            // In a real game, this would be a compressed binary buffer
            dynamicBodies.forEach((item, index) => {
                const pos = item.rigidBody.translation();
                const rot = item.rigidBody.rotation();
                physicsState.push({
                    id: index,
                    p: [pos.x, pos.y, pos.z],
                    r: [rot.x, rot.y, rot.z, rot.w]
                });
            });

            if (physicsState.length > 0) {
                this.broadcast(PACKET_TYPES.STATE_UPDATE, physicsState);
            }
        }
    }
}
