import Peer, { DataConnection } from 'peerjs';
import eventBus from '../../app/events/EventBus';
import { AppContext } from '../../app/AppContext';
import { EVENTS, PACKET_TYPES } from '../../shared/constants/Constants';
import { INetworkable } from '../../shared/contracts/INetworkable';
import { EntityType, IStateUpdatePacket } from '../../shared/contracts/IEntityState';
import {
    IDesktopSourcesStatusResponsePayload,
    IDesktopStreamFramePayload,
    IDesktopStreamOfflinePayload,
    IDesktopStreamStoppedPayload,
    IDesktopStreamSummonedPayload,
    ISessionNotificationPayload,
    IFeatureSnapshotRequestPayload,
    ISessionConfigUpdatePayload,
    IOwnershipReleasePayload,
    IOwnershipRequestPayload,
    IOwnershipTransferPayload
} from '../../shared/contracts/INetworkPacket';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { RelayConnection } from './RelayConnection';
import { NetworkDispatcher } from '../protocol/PacketDispatcher';
import { NetworkSynchronizer, INetworkTransport } from '../replication/StateSynchronizer';
import { IPacketHandler } from '../protocol/PacketHandler';
import { NetworkEnvelope, PacketPayloadMap } from '../protocol/PacketTypes';
import { IReplicatedFeatureEventPayload, IReplicatedFeatureSnapshotPayload } from '../replication/FeatureReplicationService';
import { IAudioChunkPayload, IAudioChunkReceiver } from '../../shared/contracts/IVoice';

/**
 * Architectural Role: Responsible for establishing and managing peer-to-peer WebRTC connections.
 * Dispatches incoming network packets to appropriate domain handlers and 
 * provides methods for broadcasting or relaying data to connected peers.
 * Note: Use EventBus for cross-system requests (e.g. OWNERSHIP_REQUEST) 
 * to keep entities decoupled from specific networking implementation details.
 */
export class NetworkRuntime implements IUpdatable, INetworkTransport {
    public peer: Peer | null = null;
    public localPeerId: string | null = null;
    private relaySocket: WebSocket | null = null;
    public connections: Map<string, DataConnection | RelayConnection> = new Map();

    private dispatcher: NetworkDispatcher<PacketPayloadMap>;
    private synchronizer: NetworkSynchronizer;
    private ownershipSeqByEntity: Map<string, number> = new Map();
    private lastAppliedOwnershipSeqByEntity: Map<string, number> = new Map();

    constructor(private context: AppContext) {
        this.dispatcher = new NetworkDispatcher<PacketPayloadMap>();
        this.synchronizer = new NetworkSynchronizer(this, context);

        this.registerHandlers();

        eventBus.on(EVENTS.CREATE_SESSION, (customId: string) => this.initHost(customId));
        eventBus.on(EVENTS.JOIN_SESSION, (sessionId: string) => this.initGuest(sessionId));

        eventBus.on(EVENTS.REQUEST_OWNERSHIP, (payload) => {
            if (!this.context.isHost && this.context.sessionId) {
                this.sendData(this.context.sessionId, PACKET_TYPES.OWNERSHIP_REQUEST, {
                    ...payload,
                    sentAt: this.nowMs()
                });
            }
        });

        eventBus.on(EVENTS.RELEASE_OWNERSHIP, (payload) => {
            if (!this.context.isHost && this.context.sessionId) {
                this.sendData(this.context.sessionId, PACKET_TYPES.OWNERSHIP_RELEASE, {
                    ...payload,
                    sentAt: this.nowMs()
                });
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.warn('[NetworkRuntime] Tab hidden.');
            }
        });
    }

    private registerHandlers(): void {
        this.dispatcher.registerHandler(PACKET_TYPES.STATE_UPDATE, new StateUpdateHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.PLAYER_INPUT, new PlayerInputHandler(this, this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.PEER_DISCONNECT, new PeerDisconnectHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.SESSION_CONFIG_UPDATE, new SessionConfigHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_REQUEST, new OwnershipRequestHandler(this, this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_RELEASE, new OwnershipReleaseHandler(this, this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_TRANSFER, new OwnershipTransferHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.PEER_JOINED, new PeerJoinedHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.FEATURE_EVENT, new FeatureEventHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.FEATURE_SNAPSHOT, new FeatureSnapshotHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.FEATURE_SNAPSHOT_REQUEST, new FeatureSnapshotRequestHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.DESKTOP_SOURCES_STATUS_RESPONSE, new DesktopSourcesStatusHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.DESKTOP_STREAM_SUMMONED, new DesktopStreamSummonedHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.DESKTOP_STREAM_STOPPED, new DesktopStreamStoppedHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.DESKTOP_STREAM_OFFLINE, new DesktopStreamOfflineHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.DESKTOP_STREAM_FRAME, new DesktopStreamFrameHandler(this.context));
        this.dispatcher.registerHandler(PACKET_TYPES.SESSION_NOTIFICATION, new SessionNotificationHandler(this.context));
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
            console.log(`[NetworkRuntime] Host Peer ID: ${id}`);
            this.context.sessionId = id;

            if (this.context.runtime.media) {
                this.context.runtime.media.bindPeer(this.peer!);
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
            console.log(`[NetworkRuntime] Guest Peer ID: ${id}`);
            this.context.sessionId = hostId;
            if (this.context.runtime.media) {
                this.context.runtime.media.bindPeer(this.peer!);
            }

            const conn = this.peer!.connect(hostId, { reliable: true });
            this.setupConnection(conn);
        });
    }

    private async initWebSocketOnly(sessionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.hostname;
            const port = window.location.port;
            const portPart = (port === '443' || port === '80' || port === '') ? '' : `:${port}`;
            const url = `${protocol}//${host}${portPart}/relay`;

            this.relaySocket = new WebSocket(url);
            this.relaySocket.binaryType = 'arraybuffer';

            const peerId = this.context.localPlayer?.id || 'guest-' + Math.random().toString(36).substr(2, 9);
            this.localPeerId = peerId;

            this.relaySocket.onopen = () => {
                console.log('[NetworkRuntime] Connected to Headless Server WebSocket');
                this.relaySocket!.send(JSON.stringify({ type: 'join', sessionId: sessionId, peerId: peerId }));
                this.context.sessionId = sessionId;

                const serverConn = new ServerConnection(this.relaySocket!, peerId);
                this.setupConnection(serverConn as any);

                // Wait to emit connection until server responds to match PeerJS behavior

                // VoiceRuntime integration hook
                if (this.context.runtime.media) {
                    this.context.runtime.media.bindWebSocket(this.relaySocket!);
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
                const welcomeConfig = { ...this.context.sessionConfig, assignedSpawnIndex: this.connections.size };
                this.sendData(conn.peer, PACKET_TYPES.SESSION_CONFIG_UPDATE, welcomeConfig);
                const snapshot = this.context.runtime.entity.getWorldSnapshot();
                this.sendData(conn.peer, PACKET_TYPES.STATE_UPDATE, snapshot);
                this.context.runtime.replication.sendSnapshotToPeer(conn.peer);
            } else {
                this.context.runtime.replication.requestSnapshotFromHost();
            }
        });

        conn.on('data', (data: unknown) => {
            if (data instanceof ArrayBuffer) {
                const view = new DataView(data);
                if (view.getUint8(0) === PACKET_TYPES.DESKTOP_STREAM_FRAME) {
                    this.context.runtime.remoteDesktop.handleBinaryFrame(data);
                }
                return;
            }

            if (isAudioChunkEnvelope(data)) {
                const senderId = data.senderId || conn.peer;
                const entity = this.context.runtime.entity.getEntity(senderId);
                const audioEntity = entity as (IAudioChunkReceiver | undefined);
                if (audioEntity && typeof audioEntity.onAudioChunk === 'function') {
                    audioEntity.onAudioChunk(data.payload);
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
            if (!this.context.isHost && conn.peer === this.context.sessionId) {
                eventBus.emit(EVENTS.HOST_DISCONNECTED);
            }
        });
    }

    public update(delta: number): void {
        this.synchronizer.update(delta);
    }

    public syncStateManually(): void {
        this.synchronizer.syncState();
    }

    public syncEntityNow(entityId: string, forceFullState: boolean = false): void {
        this.synchronizer.syncEntityNow(entityId, forceFullState);
    }

    public requestSessionConfigUpdate(payload: ISessionConfigUpdatePayload): void {
        if (this.context.isHost) {
            this.applySessionConfigUpdate(payload);
            return;
        }

        if (this.context.sessionId) {
            this.sendData(this.context.sessionId, PACKET_TYPES.SESSION_CONFIG_UPDATE, payload);
        }
    }

    public applySessionConfigUpdate(payload: ISessionConfigUpdatePayload): void {
        this.context.runtime.session.updateConfig(payload);
        this.broadcast(PACKET_TYPES.SESSION_CONFIG_UPDATE, { ...this.context.sessionConfig });
    }

    public applyStateUpdate(
        entityStates: IStateUpdatePacket[],
        source: 'state_update' | 'player_input' = 'state_update',
        senderId?: string
    ): void {
        const runtime = this.context.runtime;
        const localId = this.context.localPlayer?.id || 'local';
        for (const stateData of entityStates) {
            let entity = runtime.entity.getEntity(stateData.id);
            if (!entity) {
                // Skip if this is actually us (should already be in entities, but be safe)
                if (this.context.localPlayer && stateData.id === this.context.localPlayer.id) continue;

                const config = {
                    spawnPos: { x: 0, y: 0, z: 0 },
                    spawnYaw: 0,
                    isAuthority: false,
                    controlMode: stateData.type === EntityType.PLAYER_AVATAR ? 'remote' : undefined
                };
                entity = runtime.entity.discover(stateData.id, stateData.type, config) || undefined;
            }
            const state = stateData.state as { ownerId?: string | null; o?: string | null; b?: string | null; p?: number[] };
            const hasOwnershipHint = state.ownerId !== undefined || state.o !== undefined;
            const incomingOwnerId = hasOwnershipHint
                ? (state.ownerId !== undefined ? state.ownerId : state.o)
                : undefined;

            if (entity && source === 'player_input' && stateData.type !== EntityType.PLAYER_AVATAR) {
                const currentOwnerId = (entity as { ownerId?: string | null }).ownerId ?? null;

                if (this.context.isHost) {
                    if (currentOwnerId && senderId && currentOwnerId !== senderId) {
                        continue;
                    }

                    if (
                        currentOwnerId === null &&
                        incomingOwnerId !== undefined &&
                        incomingOwnerId === senderId
                    ) {
                        (entity as { ownerId?: string | null }).ownerId = incomingOwnerId;
                        entity.isAuthority = false;
                    }
                } else if (incomingOwnerId !== undefined) {
                    (entity as { ownerId?: string | null }).ownerId = incomingOwnerId;
                    entity.isAuthority = (incomingOwnerId === localId) || (incomingOwnerId === null && this.context.isHost);
                }
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
        for (const entity of this.context.runtime.entity.entities.values()) {
            const logicEntity = entity as any;
            if (logicEntity.ownerId === peerId && !logicEntity.isLocallyControlled) {
                logicEntity.ownerId = null;
                if (logicEntity.heldBy !== undefined) logicEntity.heldBy = null;
                entity.isAuthority = true;
                const seq = this.nextOwnershipSeq(entity.id);
                this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: null, seq, sentAt: this.nowMs() });
            }
        }
    }

    public applyOwnershipTransfer(payload: IOwnershipTransferPayload): void {
        const incomingSeq = payload.seq ?? 0;
        const lastAppliedSeq = this.lastAppliedOwnershipSeqByEntity.get(payload.entityId) ?? 0;
        if (incomingSeq !== 0 && incomingSeq <= lastAppliedSeq) {
            return;
        }

        const entity = this.context.runtime.entity.getEntity(payload.entityId);
        if (!entity) return;
        if (incomingSeq !== 0) {
            this.lastAppliedOwnershipSeqByEntity.set(payload.entityId, incomingSeq);
        }

        const isLocalOwner = payload.newOwnerId === (this.context.localPlayer?.id || 'local');
        (entity as { ownerId?: string | null }).ownerId = payload.newOwnerId;
        entity.isAuthority = isLocalOwner;

        // Notify entity-level state machines (e.g. PhysicsPropEntity pending-release handoff).
        const networkable = entity as unknown as { onNetworkEvent?: (type: string, data: unknown) => void };
        networkable.onNetworkEvent?.('OWNERSHIP_TRANSFER', payload);
    }

    public handleOwnershipRequest(senderId: string, payload: IOwnershipRequestPayload): void {
        const entity = this.context.runtime.entity.getEntity(payload.entityId);
        if (!entity) return;
        const logicEntity = entity as any;
        if (!logicEntity.ownerId || logicEntity.ownerId === senderId) {
            logicEntity.ownerId = senderId;
            entity.isAuthority = (senderId === (this.context.localPlayer?.id || 'local'));
            const seq = this.nextOwnershipSeq(entity.id);
            const transferPayload = { entityId: entity.id, newOwnerId: senderId, seq, sentAt: this.nowMs() };
            logicEntity.onNetworkEvent?.('OWNERSHIP_TRANSFER', transferPayload);
            this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, transferPayload);
        }
    }

    public handleOwnershipRelease(senderId: string, payload: IOwnershipReleasePayload): void {
        const entity = this.context.runtime.entity.getEntity(payload.entityId);
        if (!entity) return;
        const logicEntity = entity as any;
        if (logicEntity.ownerId !== senderId) return;

        logicEntity.ownerId = null;
        entity.isAuthority = true;

        // Let the entity handle its own state restoration (Encapsulation)
        if (logicEntity.onNetworkEvent) {
            logicEntity.onNetworkEvent('OWNERSHIP_RELEASE', payload);
        }

        const seq = this.nextOwnershipSeq(entity.id);
        this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: null, seq, sentAt: this.nowMs() });
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
        this.context.sessionId = null;
    }

    private nextOwnershipSeq(entityId: string): number {
        const next = (this.ownershipSeqByEntity.get(entityId) ?? 0) + 1;
        this.ownershipSeqByEntity.set(entityId, next);
        return next;
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    private handlePeerError(err: any): void {
        console.error('[NetworkRuntime] PeerJS Error:', err);
        let userMessage = 'Network connection error.';

        switch (err.type) {
            case 'unavailable-id':
                userMessage = 'Session name already taken. Please choose another.';
                break;
            case 'peer-unavailable':
                userMessage = 'Session not found. Please check the name.';
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

function isAudioChunkEnvelope(data: unknown): data is NetworkEnvelope<typeof PACKET_TYPES.AUDIO_CHUNK> {
    if (!data || typeof data !== 'object') return false;

    const candidate = data as Partial<NetworkEnvelope<typeof PACKET_TYPES.AUDIO_CHUNK>>;
    const payload = candidate.payload as Partial<IAudioChunkPayload> | undefined;

    return candidate.type === PACKET_TYPES.AUDIO_CHUNK &&
        !!payload &&
        typeof payload.chunk === 'string' &&
        typeof payload.isHeader === 'boolean';
}

/**
 * HANDLERS
 */

class StateUpdateHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.STATE_UPDATE]> {
    constructor(private context: AppContext) { }
    handle(senderId: string, payload: IStateUpdatePacket[]): void {
        if (!this.context.isHost) {
            this.context.runtime.network.applyStateUpdate(payload, 'state_update', senderId);
        }
    }
}

class PlayerInputHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.PLAYER_INPUT]> {
    constructor(private network: NetworkRuntime, private context: AppContext) { }
    handle(senderId: string, payload: IStateUpdatePacket[]): void {
        this.network.applyStateUpdate(payload, 'player_input', senderId);
        if (this.context.isHost) {
            // Only relay player avatars and objects the host is NOT authoritative over
            const relayPackets = payload.filter(p => {
                if (p.type === EntityType.PLAYER_AVATAR) return true;
                const entity = this.context.runtime.entity.getEntity(p.id);
                return entity && !entity.isAuthority;
            });
            if (relayPackets.length > 0) {
                this.network.relayToOthers(senderId, PACKET_TYPES.PLAYER_INPUT, relayPackets);
            }
        }
    }
}

class PeerDisconnectHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.PEER_DISCONNECT]> {
    constructor(private context: AppContext) { }
    handle(senderId: string, payload: unknown): void {
        if (!this.context.isHost) eventBus.emit(EVENTS.PEER_DISCONNECTED, payload);
    }
}

class SessionConfigHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.SESSION_CONFIG_UPDATE]> {
    constructor(private context: AppContext) { }
    handle(senderId: string, payload: ISessionConfigUpdatePayload): void {
        if (this.context.isHost) {
            this.context.runtime.network.applySessionConfigUpdate(payload);
            return;
        }

        this.context.runtime.session.updateConfig(payload);
        const network = this.context.runtime.network as any;
        const localId = this.context.isLocalServer ? network.localPeerId : this.context.runtime.network.peer?.id;
        if (localId && !this.context.localPlayer) {
            eventBus.emit(EVENTS.SESSION_CONNECTED, localId);
        }
    }
}

class OwnershipRequestHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.OWNERSHIP_REQUEST]> {
    constructor(private network: NetworkRuntime, private context: AppContext) { }
    handle(senderId: string, payload: IOwnershipRequestPayload): void {
        if (this.context.isHost) this.network.handleOwnershipRequest(senderId, payload);
    }
}

class OwnershipReleaseHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.OWNERSHIP_RELEASE]> {
    constructor(private network: NetworkRuntime, private context: AppContext) { }
    handle(senderId: string, payload: IOwnershipReleasePayload): void {
        if (this.context.isHost) this.network.handleOwnershipRelease(senderId, payload);
    }
}

class OwnershipTransferHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.OWNERSHIP_TRANSFER]> {
    constructor(private context: AppContext) { }
    handle(senderId: string, payload: IOwnershipTransferPayload): void {
        if (!this.context.isHost) this.context.runtime.network.applyOwnershipTransfer(payload);
    }
}

class PeerJoinedHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.PEER_JOINED]> {
    constructor(private context: AppContext) { }
    handle(senderId: string, payload: { peerId: string }): void {
        if (!this.context.isHost && this.context.isLocalServer) {
            eventBus.emit(EVENTS.PEER_JOINED_SESSION, payload.peerId);
        }
    }
}

class FeatureEventHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.FEATURE_EVENT]> {
    constructor(private context: AppContext) { }
    handle(senderId: string, payload: IReplicatedFeatureEventPayload): void {
        this.context.runtime.replication.handleIncomingFeatureEvent(senderId, payload);
    }
}

class FeatureSnapshotHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.FEATURE_SNAPSHOT]> {
    constructor(private context: AppContext) { }
    handle(senderId: string, payload: IReplicatedFeatureSnapshotPayload): void {
        this.context.runtime.replication.applySnapshotPayload(payload);
    }
}

class FeatureSnapshotRequestHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.FEATURE_SNAPSHOT_REQUEST]> {
    constructor(private context: AppContext) { }
    handle(senderId: string, payload: IFeatureSnapshotRequestPayload): void {
        if (!this.context.isHost) return;
        this.context.runtime.replication.sendSnapshotToPeer(senderId);
    }
}

class DesktopSourcesStatusHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.DESKTOP_SOURCES_STATUS_RESPONSE]> {
    constructor(private context: AppContext) { }
    handle(_senderId: string, payload: IDesktopSourcesStatusResponsePayload): void {
        this.context.runtime.remoteDesktop.handleSourcesStatus(payload);
    }
}

class DesktopStreamSummonedHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.DESKTOP_STREAM_SUMMONED]> {
    constructor(private context: AppContext) { }
    handle(_senderId: string, payload: IDesktopStreamSummonedPayload): void {
        this.context.runtime.remoteDesktop.handleStreamSummoned(payload);
    }
}

class DesktopStreamStoppedHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.DESKTOP_STREAM_STOPPED]> {
    constructor(private context: AppContext) { }
    handle(_senderId: string, payload: IDesktopStreamStoppedPayload): void {
        this.context.runtime.remoteDesktop.handleStreamStopped(payload);
    }
}

class DesktopStreamOfflineHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.DESKTOP_STREAM_OFFLINE]> {
    constructor(private context: AppContext) { }
    handle(_senderId: string, payload: IDesktopStreamOfflinePayload): void {
        this.context.runtime.remoteDesktop.handleStreamOffline(payload);
    }
}

class DesktopStreamFrameHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.DESKTOP_STREAM_FRAME]> {
    constructor(private context: AppContext) { }
    handle(_senderId: string, payload: IDesktopStreamFramePayload): void {
        this.context.runtime.remoteDesktop.handleStreamFrame(payload);
    }
}

class SessionNotificationHandler implements IPacketHandler<PacketPayloadMap[typeof PACKET_TYPES.SESSION_NOTIFICATION]> {
    constructor(private context: AppContext) { }
    handle(_senderId: string, payload: ISessionNotificationPayload): void {
        const localPeerId = this.context.localPlayer?.id;
        if (payload.actorPeerId && localPeerId && payload.actorPeerId === localPeerId) return;

        let message = payload.message || '';
        if (!message) {
            const actor = payload.actorName || 'Someone';
            const subject = payload.subjectName || 'a screen';

            switch (payload.kind) {
                case 'desktop_stream_started':
                    message = `${actor} started sharing ${subject}.`;
                    break;
                case 'desktop_stream_stopped':
                    message = `${subject} sharing stopped.`;
                    break;
                case 'desktop_stream_offline':
                    message = `${subject} went offline.`;
                    break;
                case 'system':
                    message = payload.message || 'System Notification';
                    break;
                default:
                    message = payload.message || payload.kind;
            }
        }

        eventBus.emit(EVENTS.SYSTEM_NOTIFICATION, message);
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
            if (e.data instanceof ArrayBuffer) {
                this.emit('data', e.data);
                return;
            }
            try {
                const data = JSON.parse(e.data);
                if (data.type === 'peer-joined' || data.type === 'peer-left') return;
                this.emit('data', data);
            } catch (err) {
                // Ignore parsing errors for non-JSON traffic
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
            // Data from NetworkRuntime is already stringified JSON
            this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
        }
    }
    public close() {
        this.socket.close();
    }
}
