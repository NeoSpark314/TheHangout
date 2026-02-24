import Peer, { DataConnection } from 'peerjs';
import eventBus from '../core/EventBus';
import gameState from '../core/GameState';
import { EVENTS, PACKET_TYPES } from '../utils/Constants';
import { INetworkable } from '../interfaces/INetworkable';
import { EntityType } from '../interfaces/IEntityState';
import { startKeepalive, stopKeepalive } from '../utils/HostKeepalive';
import { RelayConnection } from '../utils/RelayConnection';
import { NetworkDispatcher } from './NetworkDispatcher';
import { NetworkSynchronizer, NetworkTransport } from './NetworkSynchronizer';
import { PacketHandler } from './PacketHandler';

/**
 * Architectural Role: Manages transport and routing of network packets.
 * Note: Use EventBus for cross-system requests (e.g. OWNERSHIP_REQUEST) 
 * to keep entities decoupled from specific networking implementation details.
 */
export class NetworkManager implements NetworkTransport {
    public peer: Peer | null = null;
    private relaySocket: WebSocket | null = null;
    public connections: Map<string, DataConnection | RelayConnection> = new Map();
    
    private dispatcher: NetworkDispatcher;
    private synchronizer: NetworkSynchronizer;

    constructor() {
        this.dispatcher = new NetworkDispatcher();
        this.synchronizer = new NetworkSynchronizer(this);

        this.registerHandlers();

        eventBus.on(EVENTS.CREATE_ROOM, (customId: string) => this.initHost(customId));
        eventBus.on(EVENTS.JOIN_ROOM, (roomId: string) => this.initGuest(roomId));
        
        eventBus.on(EVENTS.REQUEST_OWNERSHIP, (payload: any) => {
            if (!gameState.isHost && gameState.roomId) {
                this.sendData(gameState.roomId, PACKET_TYPES.OWNERSHIP_REQUEST, payload);
            }
        });
        
        eventBus.on(EVENTS.RELEASE_OWNERSHIP, (payload: any) => {
            if (!gameState.isHost && gameState.roomId) {
                this.sendData(gameState.roomId, PACKET_TYPES.OWNERSHIP_RELEASE, payload);
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!gameState.isDedicatedHost) return;
            if (document.hidden) {
                console.warn('[NetworkManager] Tab hidden — keepalive worker active.');
                if (gameState.managers.hud) {
                    gameState.managers.hud.showNotification('⚠ Tab hidden — sync running via worker', 8000);
                }
            }
        });
    }

    private registerHandlers(): void {
        this.dispatcher.registerHandler(PACKET_TYPES.STATE_UPDATE, new StateUpdateHandler());
        this.dispatcher.registerHandler(PACKET_TYPES.PLAYER_INPUT, new PlayerInputHandler(this));
        this.dispatcher.registerHandler(PACKET_TYPES.PEER_DISCONNECT, new PeerDisconnectHandler());
        this.dispatcher.registerHandler(PACKET_TYPES.ROOM_CONFIG_UPDATE, new RoomConfigHandler());
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_REQUEST, new OwnershipRequestHandler(this));
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_RELEASE, new OwnershipReleaseHandler(this));
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_TRANSFER, new OwnershipTransferHandler());
        this.dispatcher.registerHandler(PACKET_TYPES.DRAW_LINE_SEGMENT, new DrawLineHandler());
    }

    private getPeerConfig(): any {
        if (gameState.isLocalServer) {
            return {
                host: window.location.hostname,
                port: parseInt(window.location.port) || 443,
                path: '/peerjs',
                secure: window.location.protocol === 'https:',
                debug: 2,
                config: { iceServers: [] }
            };
        }
        return { debug: 2 };
    }

    public async initRelay(peerId: string, roomId: string): Promise<WebSocket | null> {
        if (!gameState.isLocalServer) return null;

        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.hostname;
            const port = window.location.port;
            const portPart = (port === '443' || port === '80' || port === '') ? '' : `:${port}`;
            const url = `${protocol}//${host}${portPart}/relay`;

            this.relaySocket = new WebSocket(url);
            this.relaySocket.onopen = () => {
                this.relaySocket!.send(JSON.stringify({ type: 'join', roomId: roomId || peerId, peerId: peerId }));
                resolve(this.relaySocket);
            };

            this.relaySocket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'peer-joined') {
                    if (gameState.isHost) {
                        const conn = new RelayConnection(this.relaySocket!, peerId, data.peerId, true);
                        this.setupConnection(conn as any);
                    }
                } else if (data.type === 'relay') {
                    const conn = this.connections.get(data.from);
                    if (conn instanceof RelayConnection) {
                        conn.handleData(data.payload);
                    } else if (!gameState.isHost && data.from === gameState.roomId) {
                        const conn = new RelayConnection(this.relaySocket!, peerId, data.from, false);
                        this.setupConnection(conn as any);
                        conn.handleData(data.payload);
                    }
                } else if (data.type === 'peer-left') {
                    const conn = this.connections.get(data.peerId);
                    if (conn) conn.close();
                }
            };
            this.relaySocket.onerror = (err) => reject(err);
        });
    }

    public async initHost(customId: string): Promise<void> {
        const config = this.getPeerConfig();
        this.peer = customId ? new Peer(customId, config) : new Peer(config);

        if (gameState.isLocalServer) {
            const initialId = customId || (this.peer.id ? this.peer.id : null);
            if (initialId) {
                this.initRelay(initialId, initialId).catch(e => console.error('[NetworkManager] Relay init failed:', e));
            }
        }

        this.peer.on('open', async (id) => {
            console.log(`[NetworkManager] Host Peer ID: ${id}`);
            gameState.roomId = id;

            if (gameState.isLocalServer && !this.relaySocket) {
                this.initRelay(id, id).catch(e => console.error('[NetworkManager] Relay init failed:', e));
            }
            if (gameState.managers.media) {
                gameState.managers.media.bindPeer(this.peer);
            }

            if (gameState.isDedicatedHost) {
                startKeepalive(() => {
                    if (document.hidden) this.syncStateManually();
                });
            }
            eventBus.emit(EVENTS.HOST_READY, id);
        });

        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });
    }

    public async initGuest(hostId: string): Promise<void> {
        const config = this.getPeerConfig();
        this.peer = new Peer(config);

        if (gameState.isLocalServer) {
            const tempId = 'guest-' + Math.random().toString(36).substr(2, 9);
            this.initRelay(tempId, hostId).then(() => {
                if (!this.connections.has(hostId)) {
                    const conn = new RelayConnection(this.relaySocket!, tempId, hostId, false);
                    this.setupConnection(conn as any);
                }
            }).catch(e => console.warn('[NetworkManager] Local Relay init failed:', e));
        }

        this.peer.on('open', async (id) => {
            console.log(`[NetworkManager] Guest Peer ID: ${id}`);
            gameState.roomId = hostId;
            if (gameState.managers.media) {
                gameState.managers.media.bindPeer(this.peer);
            }
            if (gameState.isLocalServer && this.connections.has(hostId)) return;

            const conn = this.peer!.connect(hostId, { reliable: true });
            this.setupConnection(conn);
        });
    }

    private setupConnection(conn: DataConnection | RelayConnection): void {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            if (gameState.isHost) {
                const welcomeConfig = { ...gameState.roomConfig, assignedSpawnIndex: this.connections.size };
                this.sendData(conn.peer, PACKET_TYPES.ROOM_CONFIG_UPDATE, welcomeConfig);
                const snapshot = gameState.managers.entity.getWorldSnapshot();
                this.sendData(conn.peer, PACKET_TYPES.STATE_UPDATE, snapshot);
            }
        });

        conn.on('data', (data: any) => {
            this.dispatcher.dispatch(conn.peer, data);
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, conn.peer);
            if (gameState.isHost) {
                this.reclaimOwnership(conn.peer);
                this.broadcast(PACKET_TYPES.PEER_DISCONNECT, conn.peer);
            }
            if (!gameState.isHost && conn.peer === gameState.roomId) {
                eventBus.emit(EVENTS.HOST_DISCONNECTED);
            }
        });
    }

    public update(delta: number): void {
        this.synchronizer.update(delta);
    }

    public syncStateManually(): void {
        // Exposed for dedicated host keepalive
        (this.synchronizer as any).syncState();
    }

    public applyStateUpdate(entityStates: any[]): void {
        const managers = gameState.managers;
        for (const stateData of entityStates) {
            let entity = managers.entity.getEntity(stateData.id);
            if (!entity) {
                // Skip if this is actually us (should already be in entities, but be safe)
                if (gameState.localPlayer && stateData.id === gameState.localPlayer.id) continue;

                // Role Reversal: If someone says they are a LOCAL_PLAYER, to us they are a REMOTE_PLAYER
                const spawnType = stateData.type === EntityType.LOCAL_PLAYER ? EntityType.REMOTE_PLAYER : stateData.type;

                const config = {
                    spawnPos: { x: 0, y: 0, z: 0 },
                    spawnYaw: 0,
                    isAuthority: false
                };
                entity = managers.entity.discover(stateData.id, spawnType, config) || undefined;
            }
            if (entity && !entity.isAuthority) {
                const networkable = entity as unknown as INetworkable<any>;
                if (networkable.applyNetworkState) networkable.applyNetworkState(stateData.state);
            }
        }
    }

    public relayToOthers(senderId: string, type: number, payload: any): void {
        const data = JSON.stringify({ type, payload });
        for (const [peerId, conn] of this.connections.entries()) {
            if (conn.open && peerId !== senderId) conn.send(data);
        }
    }

    public reclaimOwnership(peerId: string): void {
        for (const entity of gameState.managers.entity.entities.values()) {
            const logicEntity = entity as any;
            if (logicEntity.ownerId === peerId) {
                logicEntity.ownerId = null;
                entity.isAuthority = true;
                this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { id: entity.id, ownerId: null });
            }
        }
    }

    public applyOwnershipTransfer(payload: any): void {
        const entity = gameState.managers.entity.getEntity(payload.id);
        if (!entity) return;
        const isLocalOwner = payload.ownerId === (gameState.localPlayer?.id || 'local');
        (entity as any).ownerId = payload.ownerId;
        entity.isAuthority = isLocalOwner;
    }

    public handleOwnershipRequest(senderId: string, payload: any): void {
        const entity = gameState.managers.entity.getEntity(payload.id);
        if (!entity) return;
        const logicEntity = entity as any;
        if (!logicEntity.ownerId || logicEntity.ownerId === senderId) {
            logicEntity.ownerId = senderId;
            entity.isAuthority = (senderId === (gameState.localPlayer?.id || 'local'));
            this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { id: entity.id, ownerId: senderId });
        }
    }

    public handleOwnershipRelease(senderId: string, payload: any): void {
        const entity = gameState.managers.entity.getEntity(payload.id);
        if (!entity) return;
        const logicEntity = entity as any;
        if (logicEntity.ownerId !== senderId) return;

        logicEntity.ownerId = null;
        entity.isAuthority = true;
        
        // Let the entity handle its own state restoration (Encapsulation)
        if (logicEntity.onNetworkEvent) {
            logicEntity.onNetworkEvent('OWNERSHIP_RELEASE', payload);
        }

        this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { id: entity.id, ownerId: null });
    }

    public sendData(targetId: string, type: number, payload: any): void {
        const conn = this.connections.get(targetId);
        if (conn && conn.open) conn.send(JSON.stringify({ type, payload }));
    }

    public broadcast(type: number, payload: any): void {
        const data = JSON.stringify({ type, payload });
        for (const conn of this.connections.values()) {
            if (conn.open) conn.send(data);
        }
    }

    public disconnect(): void {
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
    }
}

/**
 * HANDLERS
 */

class StateUpdateHandler implements PacketHandler {
    handle(senderId: string, payload: any): void {
        if (!gameState.isHost) {
            gameState.managers.network.applyStateUpdate(payload);
        }
    }
}

class PlayerInputHandler implements PacketHandler {
    constructor(private network: NetworkManager) {}
    handle(senderId: string, payload: any): void {
        this.network.applyStateUpdate(payload);
        if (gameState.isHost) {
            this.network.relayToOthers(senderId, PACKET_TYPES.PLAYER_INPUT, payload);
        }
    }
}

class PeerDisconnectHandler implements PacketHandler {
    handle(senderId: string, payload: any): void {
        if (!gameState.isHost) eventBus.emit(EVENTS.PEER_DISCONNECTED, payload);
    }
}

class RoomConfigHandler implements PacketHandler {
    handle(senderId: string, payload: any): void {
        if (!gameState.isHost) gameState.managers.room.updateConfig(payload);
    }
}

class OwnershipRequestHandler implements PacketHandler {
    constructor(private network: NetworkManager) {}
    handle(senderId: string, payload: any): void {
        if (gameState.isHost) this.network.handleOwnershipRequest(senderId, payload);
    }
}

class OwnershipReleaseHandler implements PacketHandler {
    constructor(private network: NetworkManager) {}
    handle(senderId: string, payload: any): void {
        if (gameState.isHost) this.network.handleOwnershipRelease(senderId, payload);
    }
}

class OwnershipTransferHandler implements PacketHandler {
    handle(senderId: string, payload: any): void {
        if (!gameState.isHost) gameState.managers.network.applyOwnershipTransfer(payload);
    }
}

class DrawLineHandler implements PacketHandler {
    handle(senderId: string, payload: any): void {
        if (gameState.managers.drawing) {
            gameState.managers.drawing.drawLine(payload);
        }
    }
}
