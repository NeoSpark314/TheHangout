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
            if (gameState.localPlayer) {
                // Update LocalPlayer ID so broadcasts use the true peerId
                gameState.managers.entity.updateEntityId(gameState.localPlayer.id, id);
            }
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

            if (gameState.localPlayer) {
                // Update LocalPlayer ID so inputs use the true peerId
                gameState.managers.entity.updateEntityId(gameState.localPlayer.id, id);
            }

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
        try {
            const parsed = JSON.parse(data);

            switch (parsed.type) {
                case PACKET_TYPES.STATE_UPDATE:
                    // Host -> Guest update
                    if (!gameState.isHost) {
                        this.applyStateUpdate(parsed.payload);
                    }
                    break;
                case PACKET_TYPES.PLAYER_INPUT:
                    // Guest -> Host input or Host -> Guest relay
                    this.applyStateUpdate(parsed.payload);

                    // Host relays guest updates to all other guests
                    if (gameState.isHost) {
                        this.relayToOthers(senderId, parsed.type, parsed.payload);
                    }
                    break;
                default:
                    console.warn('[NetworkManager] Unknown packet type:', parsed.type);
            }
        } catch (e) {
            console.error('[NetworkManager] Failed to parse incoming data', e);
        }
    }

    applyStateUpdate(entityStates) {
        if (!gameState.managers.entity) return;

        for (const stateData of entityStates) {
            const entity = gameState.managers.entity.getEntity(stateData.id);
            if (entity && !entity.isAuthority) {
                entity.setNetworkState(stateData.state);
            }
        }
    }

    relayToOthers(senderId, type, payload) {
        const data = JSON.stringify({ type, payload });
        for (const [peerId, conn] of this.connections.entries()) {
            if (conn.open && peerId !== senderId) {
                conn.send(data);
            }
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
        if (!gameState.managers.entity) return;

        // Get all states this client is authoritative over
        const authoritativeStates = gameState.managers.entity.getAuthoritativeStates();

        if (authoritativeStates.length === 0) return;

        if (gameState.isHost) {
            // Host broadcasts its authoritative states (e.g. its own player + all physics props) to everyone
            this.broadcast(PACKET_TYPES.STATE_UPDATE, authoritativeStates);
        } else if (gameState.roomId) {
            // Guest sends its authoritative states (just its own player) to the Host
            this.sendData(gameState.roomId, PACKET_TYPES.PLAYER_INPUT, authoritativeStates);
        }
    }
}
