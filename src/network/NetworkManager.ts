import Peer, { DataConnection } from 'peerjs';
import eventBus from '../core/EventBus';
import { GameContext } from '../core/GameState';
import { EVENTS, PACKET_TYPES } from '../utils/Constants';
import { INetworkable } from '../interfaces/INetworkable';
import { EntityType, StateUpdatePacket } from '../interfaces/IEntityState';
import { RoomConfigUpdatePayload, DrawSegmentPayload } from '../interfaces/INetworkPacket';
import { IUpdatable } from '../interfaces/IUpdatable';
import { startKeepalive, stopKeepalive } from '../utils/HostKeepalive';
import { RelayConnection } from '../utils/RelayConnection';
import { NetworkDispatcher } from './NetworkDispatcher';
import { NetworkSynchronizer, NetworkTransport } from './NetworkSynchronizer';
import { PacketHandler } from './PacketHandler';

/**
 * Architectural Role: Responsible for establishing and managing peer-to-peer WebRTC connections.
 * Dispatches incoming network packets to appropriate domain handlers and 
 * provides methods for broadcasting or relaying data to connected peers.
 * Note: Use EventBus for cross-system requests (e.g. OWNERSHIP_REQUEST) 
 * to keep entities decoupled from specific networking implementation details.
 */
export class NetworkManager implements IUpdatable, NetworkTransport {
    public peer: Peer | null = null;
    private relaySocket: WebSocket | null = null;
    public connections: Map<string, DataConnection | RelayConnection> = new Map();

    private dispatcher: NetworkDispatcher;
    private synchronizer: NetworkSynchronizer;

    constructor(private context: GameContext) {
        this.dispatcher = new NetworkDispatcher();
        this.synchronizer = new NetworkSynchronizer(this, context);

        this.registerHandlers();

        eventBus.on(EVENTS.CREATE_ROOM, (customId: string) => this.initHost(customId));
        eventBus.on(EVENTS.JOIN_ROOM, (roomId: string) => this.initGuest(roomId));

        eventBus.on(EVENTS.REQUEST_OWNERSHIP, (payload: unknown) => {
            if (!this.context.isHost && this.context.roomId) {
                this.sendData(this.context.roomId, PACKET_TYPES.OWNERSHIP_REQUEST, payload);
            }
        });

        eventBus.on(EVENTS.RELEASE_OWNERSHIP, (payload: unknown) => {
            if (!this.context.isHost && this.context.roomId) {
                this.sendData(this.context.roomId, PACKET_TYPES.OWNERSHIP_RELEASE, payload);
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!this.context.isDedicatedHost) return;
            if (document.hidden) {
                console.warn('[NetworkManager] Tab hidden — keepalive worker active.');
                if (this.context.managers.hud) {
                    this.context.managers.hud.showNotification('⚠ Tab hidden — sync running via worker', 8000);
                }
            }
        });
    }

    private registerHandlers(): void {
        this.dispatcher.registerHandler(PACKET_TYPES.STATE_UPDATE, new StateUpdateHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.PLAYER_INPUT, new PlayerInputHandler(this, this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.PEER_DISCONNECT, new PeerDisconnectHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.ROOM_CONFIG_UPDATE, new RoomConfigHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_REQUEST, new OwnershipRequestHandler(this, this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_RELEASE, new OwnershipReleaseHandler(this, this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_TRANSFER, new OwnershipTransferHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.DRAW_LINE_SEGMENT, new DrawLineHandler(this.context));
    }

    private getPeerConfig(): any {
        if (this.context.isLocalServer) {
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
        if (!this.context.isLocalServer) return null;

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
                    if (this.context.isHost) {
                        const conn = new RelayConnection(this.relaySocket!, peerId, data.peerId, true);
                        this.setupConnection(conn);
                    }
                } else if (data.type === 'relay') {
                    const conn = this.connections.get(data.from);
                    if (conn instanceof RelayConnection) {
                        conn.handleData(data.payload);
                    } else if (!this.context.isHost && data.from === this.context.roomId) {
                        const conn = new RelayConnection(this.relaySocket!, peerId, data.from, false);
                        this.setupConnection(conn);
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

        if (this.context.isLocalServer) {
            const initialId = customId || (this.peer.id ? this.peer.id : null);
            if (initialId) {
                this.initRelay(initialId, initialId).catch(e => console.error('[NetworkManager] Relay init failed:', e));
            }
        }

        this.peer.on('open', async (id) => {
            console.log(`[NetworkManager] Host Peer ID: ${id}`);
            this.context.roomId = id;

            if (this.context.isLocalServer && !this.relaySocket) {
                this.initRelay(id, id).catch(e => console.error('[NetworkManager] Relay init failed:', e));
            }
            if (this.context.managers.media) {
                this.context.managers.media.bindPeer(this.peer);
            }

            if (this.context.isDedicatedHost) {
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

        if (this.context.isLocalServer) {
            const tempId = 'guest-' + Math.random().toString(36).substr(2, 9);
            this.initRelay(tempId, hostId).then(() => {
                if (!this.connections.has(hostId)) {
                    const conn = new RelayConnection(this.relaySocket!, tempId, hostId, false);
                    this.setupConnection(conn);
                }
            }).catch(e => console.warn('[NetworkManager] Local Relay init failed:', e));
        }

        this.peer.on('open', async (id) => {
            console.log(`[NetworkManager] Guest Peer ID: ${id}`);
            this.context.roomId = hostId;
            if (this.context.managers.media) {
                this.context.managers.media.bindPeer(this.peer);
            }
            if (this.context.isLocalServer && this.connections.has(hostId)) return;

            const conn = this.peer!.connect(hostId, { reliable: true });
            this.setupConnection(conn);
        });
    }

    private setupConnection(conn: DataConnection | RelayConnection): void {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            if (this.context.isHost) {
                const welcomeConfig = { ...this.context.roomConfig, assignedSpawnIndex: this.connections.size };
                this.sendData(conn.peer, PACKET_TYPES.ROOM_CONFIG_UPDATE, welcomeConfig);
                const snapshot = this.context.managers.entity.getWorldSnapshot();
                this.sendData(conn.peer, PACKET_TYPES.STATE_UPDATE, snapshot);
            }
        });

        conn.on('data', (data: unknown) => {
            this.dispatcher.dispatch(conn.peer, data);
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, conn.peer);
            if (this.context.isHost) {
                this.reclaimOwnership(conn.peer);
                this.broadcast(PACKET_TYPES.PEER_DISCONNECT, conn.peer);
            }
            if (!this.context.isHost && conn.peer === this.context.roomId) {
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

    public applyStateUpdate(entityStates: StateUpdatePacket[]): void {
        const managers = this.context.managers;
        for (const stateData of entityStates) {
            let entity = managers.entity.getEntity(stateData.id);
            if (!entity) {
                // Skip if this is actually us (should already be in entities, but be safe)
                if (this.context.localPlayer && stateData.id === this.context.localPlayer.id) continue;

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
                const networkable = entity as unknown as INetworkable<unknown>;
                if (networkable.applyNetworkState) networkable.applyNetworkState(stateData.state);
            }
        }
    }

    public relayToOthers(senderId: string, type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload });
        for (const [peerId, conn] of this.connections.entries()) {
            if (conn.open && peerId !== senderId) conn.send(data);
        }
    }

    public reclaimOwnership(peerId: string): void {
        for (const entity of this.context.managers.entity.entities.values()) {
            const logicEntity = entity as { ownerId?: string | null, isLocallyControlled?: boolean };
            if (logicEntity.ownerId === peerId && !logicEntity.isLocallyControlled) {
                logicEntity.ownerId = null;
                entity.isAuthority = true;
                this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: null });
            }
        }
    }

    public applyOwnershipTransfer(payload: { entityId: string, newOwnerId: string | null }): void {
        const entity = this.context.managers.entity.getEntity(payload.entityId);
        if (!entity) return;
        const isLocalOwner = payload.newOwnerId === (this.context.localPlayer?.id || 'local');
        (entity as { ownerId?: string | null }).ownerId = payload.newOwnerId;
        entity.isAuthority = isLocalOwner;
    }

    public handleOwnershipRequest(senderId: string, payload: { entityId: string }): void {
        const entity = this.context.managers.entity.getEntity(payload.entityId);
        if (!entity) return;
        const logicEntity = entity as any;
        if (!logicEntity.ownerId || logicEntity.ownerId === senderId) {
            logicEntity.ownerId = senderId;
            entity.isAuthority = (senderId === (this.context.localPlayer?.id || 'local'));
            this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: senderId });
        }
    }

    public handleOwnershipRelease(senderId: string, payload: { entityId: string }): void {
        const entity = this.context.managers.entity.getEntity(payload.entityId);
        if (!entity) return;
        const logicEntity = entity as any;
        if (logicEntity.ownerId !== senderId) return;

        logicEntity.ownerId = null;
        entity.isAuthority = true;

        // Let the entity handle its own state restoration (Encapsulation)
        if (logicEntity.onNetworkEvent) {
            logicEntity.onNetworkEvent('OWNERSHIP_RELEASE', payload);
        }

        this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: null });
    }

    public sendData(targetId: string, type: number, payload: unknown): void {
        const conn = this.connections.get(targetId);
        if (conn && conn.open) conn.send(JSON.stringify({ type, payload }));
    }

    public broadcast(type: number, payload: unknown): void {
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
        this.context.roomId = null;
    }
}

/**
 * HANDLERS
 */

class StateUpdateHandler implements PacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: StateUpdatePacket[]): void {
        if (!this.context.isHost) {
            this.context.managers.network.applyStateUpdate(payload);
        }
    }
}

class PlayerInputHandler implements PacketHandler {
    constructor(private network: NetworkManager, private context: GameContext) { }
    handle(senderId: string, payload: StateUpdatePacket[]): void {
        this.network.applyStateUpdate(payload);
        if (this.context.isHost) {
            this.network.relayToOthers(senderId, PACKET_TYPES.PLAYER_INPUT, payload);
        }
    }
}

class PeerDisconnectHandler implements PacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: unknown): void {
        if (!this.context.isHost) eventBus.emit(EVENTS.PEER_DISCONNECTED, payload);
    }
}

class RoomConfigHandler implements PacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: RoomConfigUpdatePayload): void {
        if (!this.context.isHost) this.context.managers.room.updateConfig(payload);
    }
}

class OwnershipRequestHandler implements PacketHandler {
    constructor(private network: NetworkManager, private context: GameContext) { }
    handle(senderId: string, payload: { entityId: string }): void {
        if (this.context.isHost) this.network.handleOwnershipRequest(senderId, payload);
    }
}

class OwnershipReleaseHandler implements PacketHandler {
    constructor(private network: NetworkManager, private context: GameContext) { }
    handle(senderId: string, payload: { entityId: string, newOwnerId: string }): void {
        if (this.context.isHost) this.network.handleOwnershipRelease(senderId, payload);
    }
}

class OwnershipTransferHandler implements PacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: { entityId: string, newOwnerId: string | null }): void {
        if (!this.context.isHost) this.context.managers.network.applyOwnershipTransfer(payload);
    }
}

class DrawLineHandler implements PacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: DrawSegmentPayload): void {
        if (this.context.managers.drawing) {
            this.context.managers.drawing.drawLine(payload);
        }
    }
}
