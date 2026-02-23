// managers/NetworkManager.js
import Peer from 'peerjs';
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS, PACKET_TYPES } from '../utils/Constants.js';
import { EntityFactory } from '../factories/EntityFactory.js';
import { startKeepalive, stopKeepalive } from '../utils/HostKeepalive.js';
import { RelayConnection } from '../utils/RelayConnection.js';

export class NetworkManager {
    constructor() {
        this.peer = null;
        this.relaySocket = null;
        this.connections = new Map(); // peerId -> DataConnection / RelayConnection

        // Sync Timing (e.g. 20 Hz)
        this.syncRate = 1 / 20;
        this.timeSinceLastSync = 0;

        // Bind events
        eventBus.on(EVENTS.CREATE_ROOM, (customId) => this.initHost(customId));
        eventBus.on(EVENTS.JOIN_ROOM, (roomId) => this.initGuest(roomId));

        // Tab visibility warning for dedicated host
        document.addEventListener('visibilitychange', () => {
            if (!gameState.isDedicatedHost) return;
            if (document.hidden) {
                console.warn('[NetworkManager] Tab hidden — keepalive worker active.');
                if (gameState.managers.hud) {
                    gameState.managers.hud.showNotification('⚠ Tab hidden — sync running via worker', 8000);
                }
            } else {
                console.log('[NetworkManager] Tab visible again.');
            }
        });
    }

    /**
     * Build PeerJS config — local signaling server or PeerJS cloud.
     */
    getPeerConfig() {
        if (gameState.isLocalServer) {
            return {
                host: window.location.hostname,
                port: parseInt(window.location.port) || 443,
                path: '/peerjs',
                secure: window.location.protocol === 'https:',
                debug: 2,
                config: {
                    // Force local-only (no STUN/TURN) when on local server
                    // to avoid timeouts in restricted environments
                    iceServers: []
                }
            };
        }
        return { debug: 2 }; // PeerJS cloud fallback
    }

    async initRelay(peerId, roomId) {
        if (!gameState.isLocalServer) return null;

        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.hostname;
            const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
            const url = `${protocol}//${host}:${port}/relay`;

            console.log(`[NetworkManager] Connecting to Relay: ${url}`);
            this.relaySocket = new WebSocket(url);

            this.relaySocket.onopen = () => {
                console.log('[NetworkManager] Relay Socket Open');
                this.relaySocket.send(JSON.stringify({
                    type: 'join',
                    roomId: roomId || peerId,
                    peerId: peerId
                }));
                resolve(this.relaySocket);
            };

            this.relaySocket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'peer-joined') {
                    console.log(`[NetworkManager] Relay: Peer joined: ${data.peerId}`);
                    // If we are host, we "accept" this connection
                    if (gameState.isHost) {
                        const conn = new RelayConnection(this.relaySocket, peerId, data.peerId, true);
                        this.setupConnection(conn);
                    }
                } else if (data.type === 'relay') {
                    const conn = this.connections.get(data.from);
                    if (conn && conn instanceof RelayConnection) {
                        conn.handleData(data.payload);
                    } else if (!gameState.isHost && data.from === gameState.roomId) {
                        // We are guest, and this is the host talking to us via relay for the first time
                        // If we don't have a connection yet, create one
                        const conn = new RelayConnection(this.relaySocket, peerId, data.from, false);
                        this.setupConnection(conn);
                        conn.handleData(data.payload);
                    }
                } else if (data.type === 'peer-left') {
                    const conn = this.connections.get(data.peerId);
                    if (conn) conn.close();
                }
            };

            this.relaySocket.onerror = (err) => {
                console.error('[NetworkManager] Relay Socket Error:', err);
                reject(err);
            };
        });
    }

    async initHost(customId) {
        const config = this.getPeerConfig();
        this.peer = customId ? new Peer(customId, config) : new Peer(config);

        if (gameState.isLocalServer) {
            this.peer.on('error', (err) => {
                if (err.type === 'network' || err.type === 'server-error') {
                    console.warn('[NetworkManager] PeerJS signaling failed, but we are on local server. Relay might still work.');
                }
            });
        }

        this.peer.on('open', async (id) => {
            console.log(`[NetworkManager] Host Peer ID: ${id}`);
            gameState.roomId = id;

            // Start Relay if on local server
            if (gameState.isLocalServer) {
                try {
                    await this.initRelay(id, id);
                } catch (e) {
                    console.error('[NetworkManager] Failed to init Relay fallback:', e);
                }
            }
            if (gameState.managers.media) {
                gameState.managers.media.bindPeer(this.peer);
            }

            // Start keepalive worker for dedicated host
            if (gameState.isDedicatedHost) {
                startKeepalive((delta) => {
                    // Only sync if the normal game loop isn't running (tab hidden)
                    if (document.hidden) {
                        this.syncState();
                    }
                });
            }

            eventBus.emit(EVENTS.HOST_READY, id);
        });

        this.peer.on('connection', (conn) => {
            console.log(`[NetworkManager] Guest connected: ${conn.peer}`);
            this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('[NetworkManager] Host Peer Error:', err);
            let msg = 'Room Creation Error';
            if (err.type === 'unavailable-id') {
                msg = 'Room Name already taken! Choose another.';
            } else {
                msg = `Error: ${err.type}`;
            }
            eventBus.emit(EVENTS.NETWORK_ERROR, msg);
        });
    }

    async initGuest(hostId) {
        this.peer = new Peer(this.getPeerConfig());

        this.peer.on('open', async (id) => {
            console.log(`[NetworkManager] Guest Peer ID: ${id}`);
            gameState.roomId = hostId;

            if (gameState.managers.media) {
                gameState.managers.media.bindPeer(this.peer);
            }

            if (gameState.isLocalServer) {
                try {
                    await this.initRelay(id, hostId);
                    // Use Relay instead of PeerJS connect
                    const conn = new RelayConnection(this.relaySocket, id, hostId, false);
                    this.setupConnection(conn);
                    return; // Bypass PeerJS.connect
                } catch (e) {
                    console.warn('[NetworkManager] Local Server Relay failed, falling back to PeerJS cloud/P2P.');
                }
            }

            const conn = this.peer.connect(hostId, { reliable: true });
            this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('[NetworkManager] Guest Peer Error:', err);
            let msg = 'Connection Error';
            if (err.type === 'peer-unavailable') {
                msg = 'Room not found! Check the name.';
            } else {
                msg = `Error: ${err.type}`;
            }
            eventBus.emit(EVENTS.NETWORK_ERROR, msg);
        });
    }

    setupConnection(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);

            // If we are the host, send the current room config and a world snapshot to the new guest immediately
            if (gameState.isHost) {
                this.sendData(conn.peer, PACKET_TYPES.ROOM_CONFIG_UPDATE, gameState.roomConfig);

                if (gameState.managers.entity) {
                    const snapshot = gameState.managers.entity.getWorldSnapshot();
                    this.sendData(conn.peer, PACKET_TYPES.STATE_UPDATE, snapshot);
                }
            }

            // Spawning is now data-driven: we wait for the first state update 
            // to arrive in applyStateUpdate before triggering onPeerConnected.
        });

        conn.on('data', (data) => {
            this.handleData(conn.peer, data);
        });

        conn.on('close', () => {
            console.log(`[NetworkManager] Connection closed: ${conn.peer}`);
            this.connections.delete(conn.peer);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, conn.peer);

            // If we are the host, reclaim any physics objects owned by this peer
            if (gameState.isHost) {
                this.reclaimOwnership(conn.peer);
            }

            // If we are a guest and our connection to the host closed, the session is over
            if (!gameState.isHost && conn.peer === gameState.roomId) {
                console.log('[NetworkManager] Host disconnected. Ending session.');
                eventBus.emit(EVENTS.HOST_DISCONNECTED);
            }

            // If we are the host, inform all other guests that this peer disconnected
            if (gameState.isHost) {
                this.broadcast(PACKET_TYPES.PEER_DISCONNECT, conn.peer);
            }
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
                case PACKET_TYPES.PEER_DISCONNECT:
                    // Host -> Guest notification that a peer left
                    if (!gameState.isHost) {
                        eventBus.emit(EVENTS.PEER_DISCONNECTED, parsed.payload);
                    }
                    break;
                case PACKET_TYPES.ROOM_CONFIG_UPDATE:
                    // Host -> Guest room setting update
                    if (!gameState.isHost) {
                        console.log('[NetworkManager] Received Room Config Update');
                        if (gameState.managers.room) {
                            gameState.managers.room.updateConfig(parsed.payload);
                        }
                    }
                    break;
                case PACKET_TYPES.OWNERSHIP_REQUEST:
                    if (gameState.isHost) {
                        this.handleOwnershipRequest(senderId, parsed.payload);
                    }
                    break;
                case PACKET_TYPES.OWNERSHIP_RELEASE:
                    if (gameState.isHost) {
                        this.handleOwnershipRelease(senderId, parsed.payload);
                    }
                    break;
                case PACKET_TYPES.OWNERSHIP_TRANSFER:
                    if (!gameState.isHost) {
                        this.applyOwnershipTransfer(parsed.payload);
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
            let entity = gameState.managers.entity.getEntity(stateData.id);

            // Unified Data-Driven Discovery
            if (!entity) {
                // Don't auto-spawn ourselves
                const isOwnEntity = gameState.localPlayer && stateData.id === gameState.localPlayer.id;
                if (!isOwnEntity) {
                    gameState.managers.player.handleRemoteEntityDiscovery(stateData.id, stateData.type);
                    entity = gameState.managers.entity.getEntity(stateData.id);
                }
            }

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
            // Host sends state of BOTH authoritative objects (its own) 
            // AND guest-owned physics objects to maintain eventual consistency for late joiners
            const allStates = gameState.managers.entity.getWorldSnapshot();
            this.broadcast(PACKET_TYPES.STATE_UPDATE, allStates);
        } else if (gameState.roomId) {
            // Guest sends its authoritative states (player + any owned physics) to the Host
            this.sendData(gameState.roomId, PACKET_TYPES.PLAYER_INPUT, authoritativeStates);
        }
    }

    // --- Ownership Negotiation (Host Only) ---

    handleOwnershipRequest(senderId, payload) {
        const entity = gameState.managers.entity?.getEntity(payload.id);
        if (!entity) return;

        // Arbitration Logic: Host decides if request is valid
        // For now, first-come first-served if not already owned by someone else
        if (!entity.ownerId || entity.ownerId === senderId) {
            console.log(`[NetworkManager] Granting ownership of ${entity.id} to ${senderId}`);
            entity.ownerId = senderId;
            entity.isAuthority = (senderId === (gameState.localPlayer?.id || 'local')); // Host might be the owner

            // Broadcast transfer to everyone
            this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, {
                id: entity.id,
                ownerId: senderId
            });
        } else {
            console.warn(`[NetworkManager] Denied ownership request for ${entity.id} from ${senderId}. Currently owned by ${entity.ownerId}`);
            // Explicit rejection not strictly needed; guest will be corrected by next state update
        }
    }

    handleOwnershipRelease(senderId, payload) {
        const entity = gameState.managers.entity?.getEntity(payload.id);
        if (!entity || entity.ownerId !== senderId) return;

        console.log(`[NetworkManager] Reclaiming ownership of ${entity.id} from ${senderId}`);
        entity.ownerId = null;
        entity.isAuthority = true; // Host regains authority

        // Apply final state if provided (Handoff to Sleep)
        // We set wakeUp to false (the second argument) to prevent the Host 
        // from shouting the object awake if it was already settled on the Guest.
        if (entity.rigidBody) {
            if (payload.p) {
                entity.rigidBody.setTranslation({ x: payload.p[0], y: payload.p[1], z: payload.p[2] }, false);
            }
            if (payload.r) {
                entity.rigidBody.setRotation({ x: payload.r[0], y: payload.r[1], z: payload.r[2], w: payload.r[3] }, false);
            }
            if (payload.v) {
                entity.rigidBody.setLinvel({ x: payload.v[0], y: payload.v[1], z: payload.v[2] }, true);
            }
        }

        // Broadcast release to everyone
        this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, {
            id: entity.id,
            ownerId: null
        });
    }

    reclaimOwnership(peerId) {
        if (!gameState.managers.entity) return;
        for (const entity of gameState.managers.entity.entities.values()) {
            if (entity.ownerId === peerId) {
                console.log(`[NetworkManager] Reclaiming ${entity.id} from disconnected peer ${peerId}`);
                entity.ownerId = null;
                entity.isAuthority = true;

                // Broadcast to update other guests
                this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, {
                    id: entity.id,
                    ownerId: null
                });
            }
        }
    }

    // --- Ownership Application (Guest Only) ---

    applyOwnershipTransfer(payload) {
        const entity = gameState.managers.entity?.getEntity(payload.id);
        if (!entity) return;

        const isLocalOwner = payload.ownerId === (gameState.localPlayer?.id || 'local');

        // If we are getting corrected by the host (e.g. we thought we owned it but host says otherwise),
        // or if someone else just took ownership, update our local flag.
        entity.ownerId = payload.ownerId;
        entity.isAuthority = isLocalOwner;

        console.log(`[NetworkManager] ${entity.id} ownership transferred to ${payload.ownerId || 'Host'}. Local authority: ${entity.isAuthority}`);

        eventBus.emit(EVENTS.OWNERSHIP_TRANSFERRED, payload);
    }

    disconnect() {
        stopKeepalive();

        if (this.relaySocket) {
            this.relaySocket.close();
            this.relaySocket = null;
        }

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connections.clear();
        gameState.roomId = null;
        console.log('[NetworkManager] Disconnected and destroyed peer.');
    }
}
