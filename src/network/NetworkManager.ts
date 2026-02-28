import Peer, { DataConnection } from 'peerjs';
import eventBus from '../core/EventBus';
import { GameContext } from '../core/GameState';
import { EVENTS, PACKET_TYPES } from '../utils/Constants';
import { INetworkable } from '../interfaces/INetworkable';
import { EntityType, IStateUpdatePacket } from '../interfaces/IEntityState';
import { IRoomConfigUpdatePayload, IDrawSegmentPayload } from '../interfaces/INetworkPacket';
import { IUpdatable } from '../interfaces/IUpdatable';
import { RelayConnection } from '../utils/RelayConnection';
import { NetworkDispatcher } from './NetworkDispatcher';
import { NetworkSynchronizer, INetworkTransport } from './NetworkSynchronizer';
import { IPacketHandler } from './PacketHandler';

/**
 * Architectural Role: Responsible for establishing and managing peer-to-peer WebRTC connections.
 * Dispatches incoming network packets to appropriate domain handlers and 
 * provides methods for broadcasting or relaying data to connected peers.
 * Note: Use EventBus for cross-system requests (e.g. OWNERSHIP_REQUEST) 
 * to keep entities decoupled from specific networking implementation details.
 */
export class NetworkManager implements IUpdatable, INetworkTransport {
    public peer: Peer | null = null;
    public localPeerId: string | null = null;
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
            if (document.hidden) {
                console.warn('[NetworkManager] Tab hidden.');
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
        this.dispatcher.registerHandler(PACKET_TYPES.PEER_JOINED, new PeerJoinedHandler(this.context));
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

    public async initHost(customId: string): Promise<void> {
        if (this.context.isLocalServer) {
            this.context.isHost = false; // We are just a guest on the headless server
            return this.initWebSocketOnly(customId);
        }

        const config = this.getPeerConfig();
        this.peer = customId ? new Peer(customId, config) : new Peer(config);

        this.peer.on('error', (err) => this.handlePeerError(err));

        this.peer.on('open', async (id) => {
            console.log(`[NetworkManager] Host Peer ID: ${id}`);
            this.context.roomId = id;

            if (this.context.managers.media) {
                this.context.managers.media.bindPeer(this.peer);
            }

            eventBus.emit(EVENTS.HOST_READY, id);
        });

        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });
    }

    public async initGuest(hostId: string): Promise<void> {
        if (this.context.isLocalServer) {
            return this.initWebSocketOnly(hostId);
        }

        const config = this.getPeerConfig();
        this.peer = new Peer(config);

        this.peer.on('error', (err) => this.handlePeerError(err));

        this.peer.on('open', async (id) => {
            console.log(`[NetworkManager] Guest Peer ID: ${id}`);
            this.context.roomId = hostId;
            if (this.context.managers.media) {
                this.context.managers.media.bindPeer(this.peer);
            }

            const conn = this.peer!.connect(hostId, { reliable: true });
            this.setupConnection(conn);
        });
    }

    private async initWebSocketOnly(roomId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.hostname;
            const port = window.location.port;
            const portPart = (port === '443' || port === '80' || port === '') ? '' : `:${port}`;
            const url = `${protocol}//${host}${portPart}/relay`;

            this.relaySocket = new WebSocket(url);

            const peerId = this.context.localPlayer?.id || 'guest-' + Math.random().toString(36).substr(2, 9);
            this.localPeerId = peerId;

            this.relaySocket.onopen = () => {
                console.log('[NetworkManager] Connected to Headless Server WebSocket');
                this.relaySocket!.send(JSON.stringify({ type: 'join', roomId: roomId, peerId: peerId }));
                this.context.roomId = roomId;

                const serverConn = new ServerConnection(this.relaySocket!, peerId);
                this.setupConnection(serverConn as any);

                // Wait to emit connection until server responds to match PeerJS behavior

                // MediaManager integration hook
                if (this.context.managers.media && (this.context.managers.media as any).bindWebSocket) {
                    (this.context.managers.media as any).bindWebSocket(this.relaySocket!);
                }

                resolve();
            };

            this.relaySocket.onerror = (err) => reject(err);
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

        conn.on('data', (data: any) => {
            if (data && data.type === PACKET_TYPES.AUDIO_CHUNK) {
                const senderId = data.senderId || conn.peer;
                const entity = this.context.managers.entity.getEntity(senderId);
                if (entity && (entity as any).onAudioChunk) {
                    (entity as any).onAudioChunk(data.payload);
                }
            } else {
                this.dispatcher.dispatch(conn.peer, data);
            }
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
        // Exposed for potential manual sync
        (this.synchronizer as any).syncState();
    }

    public applyStateUpdate(entityStates: IStateUpdatePacket[]): void {
        const managers = this.context.managers;
        for (const stateData of entityStates) {
            if ((stateData.type as any) === 'system') {
                console.log('[NetworkManager] System notification packet received:', (stateData.state as any).message);
                eventBus.emit(EVENTS.SYSTEM_NOTIFICATION, (stateData.state as any).message);
                continue;
            }
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
            const logicEntity = entity as any;
            if (logicEntity.ownerId === peerId && !logicEntity.isLocallyControlled) {
                logicEntity.ownerId = null;
                if (logicEntity.heldBy !== undefined) logicEntity.heldBy = null;
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
        const conn = this.connections.get(targetId) || (this.context.isLocalServer ? this.connections.get('SERVER') : undefined);
        if (conn && conn.open) conn.send(JSON.stringify({ type, payload }));
    }

    public broadcast(type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload });
        for (const conn of this.connections.values()) {
            if (conn.open) conn.send(data);
        }
    }

    public disconnect(): void {
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

    private handlePeerError(err: any): void {
        console.error('[NetworkManager] PeerJS Error:', err);
        let userMessage = 'Network connection error.';

        switch (err.type) {
            case 'unavailable-id':
                userMessage = 'Room name already taken. Please choose another.';
                break;
            case 'peer-unavailable':
                userMessage = 'Room not found. Please check the name.';
                break;
            case 'network':
                userMessage = 'Connection lost. Check your internet.';
                break;
            case 'server-error':
                userMessage = 'Signaling server unavailable.';
                break;
            case 'browser-incompatible':
                userMessage = 'Your browser does not support WebRTC.';
                break;
        }

        eventBus.emit(EVENTS.NETWORK_ERROR, userMessage);

        // If we haven't successfully opened yet, cleanup
        if (this.peer && !this.peer.open) {
            this.disconnect();
        }
    }
}

/**
 * HANDLERS
 */

class StateUpdateHandler implements IPacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: IStateUpdatePacket[]): void {
        if (!this.context.isHost) {
            this.context.managers.network.applyStateUpdate(payload);
        }
    }
}

class PlayerInputHandler implements IPacketHandler {
    constructor(private network: NetworkManager, private context: GameContext) { }
    handle(senderId: string, payload: IStateUpdatePacket[]): void {
        this.network.applyStateUpdate(payload);
        if (this.context.isHost) {
            // Only relay player avatars and objects the host is NOT authoritative over
            const relayPackets = payload.filter(p => {
                if (p.type === EntityType.LOCAL_PLAYER) return true;
                const entity = this.context.managers.entity.getEntity(p.id);
                return entity && !entity.isAuthority;
            });
            if (relayPackets.length > 0) {
                this.network.relayToOthers(senderId, PACKET_TYPES.PLAYER_INPUT, relayPackets);
            }
        }
    }
}

class PeerDisconnectHandler implements IPacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: unknown): void {
        if (!this.context.isHost) eventBus.emit(EVENTS.PEER_DISCONNECTED, payload);
    }
}

class RoomConfigHandler implements IPacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: IRoomConfigUpdatePayload): void {
        if (!this.context.isHost) {
            this.context.managers.room.updateConfig(payload);

            // If we are in local server mode, this is our cue that we are "connected" and ready to spawn
            if (this.context.isLocalServer) {
                const network = this.context.managers.network as any;
                if (network.localPeerId) {
                    eventBus.emit(EVENTS.PEER_CONNECTED, network.localPeerId);
                }
            }
        }
    }
}

class OwnershipRequestHandler implements IPacketHandler {
    constructor(private network: NetworkManager, private context: GameContext) { }
    handle(senderId: string, payload: { entityId: string }): void {
        if (this.context.isHost) this.network.handleOwnershipRequest(senderId, payload);
    }
}

class OwnershipReleaseHandler implements IPacketHandler {
    constructor(private network: NetworkManager, private context: GameContext) { }
    handle(senderId: string, payload: { entityId: string, newOwnerId: string }): void {
        if (this.context.isHost) this.network.handleOwnershipRelease(senderId, payload);
    }
}

class OwnershipTransferHandler implements IPacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: { entityId: string, newOwnerId: string | null }): void {
        if (!this.context.isHost) this.context.managers.network.applyOwnershipTransfer(payload);
    }
}

class DrawLineHandler implements IPacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: IDrawSegmentPayload): void {
        if (this.context.managers.drawing) {
            this.context.managers.drawing.drawLine(payload);
        }
    }
}

class PeerJoinedHandler implements IPacketHandler {
    constructor(private context: GameContext) { }
    handle(senderId: string, payload: { peerId: string }): void {
        if (!this.context.isHost && this.context.isLocalServer) {
            eventBus.emit(EVENTS.PEER_JOINED_ROOM, payload.peerId);
        }
    }
}

/**
 * Maps raw WebSocket connection events into PeerJS-style API
 */
class ServerConnection {
    public peer = 'SERVER';
    public open = false;
    private listeners: Record<string, Function[]> = {};

    constructor(private socket: WebSocket, public localId: string) {
        if (socket.readyState === WebSocket.OPEN) {
            setTimeout(() => { this.open = true; this.emit('open'); }, 0);
        } else {
            socket.addEventListener('open', () => { this.open = true; this.emit('open'); }, { once: true });
        }

        socket.addEventListener('message', (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.type === 'peer-joined' || data.type === 'peer-left') return;
                this.emit('data', data);
            } catch (err) {
                // Ignore parsing errors for non-JSON traffic (like audio arraybuffers later if we move from stringify)
            }
        });

        socket.addEventListener('close', () => {
            this.open = false;
            this.emit('close');
        });
    }

    public on(event: string, callback: Function) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }
    public emit(event: string, data?: any) {
        if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data));
    }
    public send(data: any) {
        if (this.open && this.socket.readyState === WebSocket.OPEN) {
            // Data from NetworkManager is already stringified JSON
            this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
        }
    }
    public close() {
        this.socket.close();
    }
}
