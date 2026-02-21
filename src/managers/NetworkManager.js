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

    initHost(customId) {
        // If customId is provided, PeerJS will attempt to use it.
        // If not, it generates a random one.
        this.peer = customId ? new Peer(customId, { debug: 2 }) : new Peer({ debug: 2 });

        this.peer.on('open', (id) => {
            console.log(`[NetworkManager] Host Peer ID: ${id}`);
            gameState.roomId = id;
            eventBus.emit(EVENTS.HOST_READY, id);
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

            // Emit connection event so PlayerManager can spawn their avatar
            eventBus.emit(EVENTS.PEER_CONNECTED, conn.peer);
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
            const lp = gameState.localPlayer;

            // Build Head Payload
            const headPayload = {
                position: { x: lp.headMesh.position.x, y: lp.headMesh.position.y, z: lp.headMesh.position.z },
                quaternion: { x: lp.headMesh.quaternion.x, y: lp.headMesh.quaternion.y, z: lp.headMesh.quaternion.z, w: lp.headMesh.quaternion.w }
            };

            // Build Hands Payload (Syncing wrist only for now to save bandwidth, full joints could be added later)
            const handsPayload = {
                left: { active: false, position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } },
                right: { active: false, position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
            };

            if (lp.handMeshes.left[0] && lp.handMeshes.left[0].visible) {
                handsPayload.left.active = true;
                const m = lp.handMeshes.left[0];
                handsPayload.left.position = { x: m.position.x, y: m.position.y, z: m.position.z };
                handsPayload.left.quaternion = { x: m.quaternion.x, y: m.quaternion.y, z: m.quaternion.z, w: m.quaternion.w };
            }
            if (lp.handMeshes.right[0] && lp.handMeshes.right[0].visible) {
                handsPayload.right.active = true;
                const m = lp.handMeshes.right[0];
                handsPayload.right.position = { x: m.position.x, y: m.position.y, z: m.position.z };
                handsPayload.right.quaternion = { x: m.quaternion.x, y: m.quaternion.y, z: m.quaternion.z, w: m.quaternion.w };
            }

            const payload = {
                position: { x: pos.x, y: pos.y, z: pos.z },
                yaw: lp.yaw,
                neckHeight: lp.neckHeight,
                head: headPayload,
                hands: handsPayload
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
