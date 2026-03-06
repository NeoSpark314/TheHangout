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
    IPeerLatencyReportPayload,
    ISessionNotificationPayload,
    IFeatureSnapshotRequestPayload,
    ISessionConfigUpdatePayload,
    IOwnershipReleasePayload,
    IOwnershipRequestPayload,
    IScenarioActionExecutePayload,
    IScenarioActionRequestPayload,
    IScenarioActionResultPayload,
    IOwnershipTransferPayload
} from '../../shared/contracts/INetworkPacket';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { NetworkDispatcher } from '../protocol/PacketDispatcher';
import { NetworkSynchronizer, INetworkTransport } from '../replication/StateSynchronizer';
import { NetworkEnvelope, PacketPayloadMap } from '../protocol/PacketTypes';
import { IReplicatedFeatureEventPayload, IReplicatedFeatureSnapshotPayload } from '../replication/FeatureReplicationService';
import { IAudioChunkPayload, IAudioChunkReceiver } from '../../shared/contracts/IVoice';
import { AuthoritativeSessionHost } from './AuthoritativeSessionHost';

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
    public connections: Map<string, DataConnection | ServerConnection> = new Map();

    private dispatcher: NetworkDispatcher<PacketPayloadMap>;
    private synchronizer: NetworkSynchronizer;
    // Host mode delegates authoritative rules to the shared coordinator so PeerJS
    // host behavior stays aligned with the dedicated server implementation.
    private authoritativeHost: AuthoritativeSessionHost;
    private probeSeq = 0;
    private timeSinceLastProbe = 0;
    private readonly probeIntervalSec = 2.0;
    private readonly maxProbeAgeMs = 15000;
    private readonly pendingLatencyProbes = new Map<string, number>();
    private ownershipSeqByEntity: Map<string, number> = new Map();
    private lastAppliedOwnershipSeqByEntity: Map<string, number> = new Map();

    constructor(private context: AppContext) {
        this.dispatcher = new NetworkDispatcher<PacketPayloadMap>();
        this.synchronizer = new NetworkSynchronizer(this, context);
        this.authoritativeHost = new AuthoritativeSessionHost(this.context, this);

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
                this.context.runtime.diagnostics.record('debug', 'network', 'Tab hidden.');
            }
        });
    }

    private registerHandlers(): void {
        // Keep packet routing in one place so host/guest behavior is easy to compare.
        this.registerRoleAwareHandler(PACKET_TYPES.STATE_UPDATE, {
            guest: (senderId, payload) => {
                this.applyStateUpdate(payload, 'state_update', senderId);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.PLAYER_INPUT, {
            host: (senderId, payload) => {
                this.handleHostPlayerInput(senderId, payload);
            },
            guest: (senderId, payload) => {
                this.applyStateUpdate(payload, 'player_input', senderId);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.PEER_DISCONNECT, {
            guest: (_senderId, payload) => {
                const peerId = typeof payload === 'string' ? payload : payload.peerId;
                eventBus.emit(EVENTS.PEER_DISCONNECTED, peerId);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.SESSION_CONFIG_UPDATE, {
            host: (_senderId, payload) => {
                this.authoritativeHost.applySessionConfigUpdate(payload);
            },
            guest: (_senderId, payload) => {
                this.context.runtime.session.applySessionConfigUpdate(payload);
                const network = this.context.runtime.network as any;
                const localId = this.context.isLocalServer ? network.localPeerId : this.context.runtime.network.peer?.id;
                if (localId && !this.context.localPlayer) {
                    eventBus.emit(EVENTS.SESSION_CONNECTED, localId);
                }
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.OWNERSHIP_REQUEST, {
            host: (senderId, payload) => {
                this.authoritativeHost.handleOwnershipRequest(senderId, payload);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.OWNERSHIP_RELEASE, {
            host: (senderId, payload) => {
                this.authoritativeHost.handleOwnershipRelease(senderId, payload);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.OWNERSHIP_TRANSFER, {
            guest: (_senderId, payload) => {
                this.applyOwnershipTransfer(payload);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.PEER_JOINED, {
            guest: (_senderId, payload) => {
                if (!this.context.isLocalServer) return;
                eventBus.emit(EVENTS.PEER_JOINED_SESSION, payload.peerId);
            }
        });

        this.registerHandler(PACKET_TYPES.FEATURE_EVENT, (senderId, payload) => {
            this.context.runtime.replication.handleIncomingFeatureEvent(senderId, payload);
        });

        this.registerRoleAwareHandler(PACKET_TYPES.FEATURE_SNAPSHOT, {
            guest: (_senderId, payload) => {
                this.context.runtime.replication.applySnapshotPayload(payload);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.FEATURE_SNAPSHOT_REQUEST, {
            host: (senderId, _payload) => {
                this.context.runtime.replication.sendSnapshotToPeer(senderId);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.SCENARIO_ACTION_REQUEST, {
            host: (senderId, payload) => {
                this.authoritativeHost.handleScenarioActionRequest(senderId, payload);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.SCENARIO_ACTION_EXECUTE, {
            guest: (_senderId, payload) => {
                this.context.runtime.scenarioActions.handleReplicatedAction(payload);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.SCENARIO_ACTION_RESULT, {
            guest: (_senderId, payload) => {
                this.context.runtime.scenarioActions.handleActionResult(payload);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.RTT_PING, {
            host: (senderId, payload) => {
                this.authoritativeHost.handleRttPing(senderId, payload);
            }
        });

        this.registerRoleAwareHandler(PACKET_TYPES.RTT_PONG, {
            guest: (_senderId, payload) => {
                this.handleRttPong(payload);
            }
        });

        this.registerHandler(PACKET_TYPES.DESKTOP_SOURCES_STATUS_RESPONSE, (_senderId, payload) => {
            this.context.runtime.remoteDesktop.handleSourcesStatus(payload);
        });

        this.registerHandler(PACKET_TYPES.DESKTOP_STREAM_SUMMONED, (_senderId, payload) => {
            this.context.runtime.remoteDesktop.handleStreamSummoned(payload);
        });

        this.registerHandler(PACKET_TYPES.DESKTOP_STREAM_STOPPED, (_senderId, payload) => {
            this.context.runtime.remoteDesktop.handleStreamStopped(payload);
        });

        this.registerHandler(PACKET_TYPES.DESKTOP_STREAM_OFFLINE, (_senderId, payload) => {
            this.context.runtime.remoteDesktop.handleStreamOffline(payload);
        });

        this.registerHandler(PACKET_TYPES.DESKTOP_STREAM_FRAME, (_senderId, payload) => {
            this.context.runtime.remoteDesktop.handleStreamFrame(payload);
        });

        this.registerHandler(PACKET_TYPES.SESSION_NOTIFICATION, (_senderId, payload) => {
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

            this.context.runtime.notify.info(message, {
                source: 'session',
                code: `session.${payload.kind || 'notification'}`
            });
        });
    }

    private registerHandler<K extends keyof PacketPayloadMap & number>(
        type: K,
        handle: (senderId: string, payload: PacketPayloadMap[K]) => void
    ): void {
        this.dispatcher.registerHandler(type, {
            handle: (senderId, payload) => {
                handle(senderId, payload as PacketPayloadMap[K]);
            }
        });
    }

    private registerRoleAwareHandler<K extends keyof PacketPayloadMap & number>(
        type: K,
        handlers: {
            host?: (senderId: string, payload: PacketPayloadMap[K]) => void;
            guest?: (senderId: string, payload: PacketPayloadMap[K]) => void;
        }
    ): void {
        this.registerHandler(type, (senderId, payload) => {
            if (this.context.isHost) {
                handlers.host?.(senderId, payload);
                return;
            }

            handlers.guest?.(senderId, payload);
        });
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
        await this.context.ensureGameplayStarted?.();

        if (this.context.isLocalServer) {
            this.context.isHost = false; // We are just a guest on the headless server
            return this.initWebSocketOnly(customId);
        }

        const config = this.getPeerConfig();
        this.peer = customId ? new Peer(customId, config) : new Peer(config);

        this.peer.on('error', (err) => this.handlePeerError(err));

        this.peer.on('open', async (id) => {
            this.context.runtime.diagnostics.record('info', 'network', `Host ready (${id})`);
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
        await this.context.ensureGameplayStarted?.();

        if (this.context.isLocalServer) {
            return this.initWebSocketOnly(hostId);
        }

        const config = this.getPeerConfig();
        this.peer = new Peer(config);

        this.peer.on('error', (err) => this.handlePeerError(err));

        this.peer.on('open', async (id) => {
            this.context.runtime.diagnostics.record('info', 'network', `Guest ready (${id})`);
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
                this.context.runtime.diagnostics.record('info', 'network', 'Connected to headless relay.');
                const joinPayload = JSON.stringify({ type: 'join', sessionId: sessionId, peerId: peerId });
                this.relaySocket!.send(joinPayload);
                this.context.runtime.diagnostics.recordNetworkSent(joinPayload.length);
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

    private setupConnection(conn: DataConnection | ServerConnection): void {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            this.context.runtime.diagnostics.record('info', 'network', `Connection opened (${conn.peer})`);
            if (this.context.isHost) {
                this.authoritativeHost.sendWelcomeState(conn.peer, this.connections.size);
            } else {
                this.context.runtime.replication.requestSnapshotFromHost();
            }
        });

        conn.on('data', (data: unknown) => {
            this.noteIncomingTraffic(data);

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
                const audioEntity = entity as unknown as (IAudioChunkReceiver | undefined);
                if (audioEntity && typeof audioEntity.onAudioChunk === 'function') {
                    audioEntity.onAudioChunk(data.payload);
                }
            } else {
                this.dispatcher.dispatch(conn.peer, data);
            }
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.context.runtime.diagnostics.record('info', 'network', `Connection closed (${conn.peer})`);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, conn.peer);
            if (this.context.isHost) {
                this.reclaimOwnership(conn.peer);
                this.authoritativeHost.notifyPeerDisconnected(conn.peer);
            }
            if (!this.context.isHost && conn.peer === this.context.sessionId) {
                eventBus.emit(EVENTS.HOST_DISCONNECTED);
            }
        });
    }

    public update(delta: number): void {
        if (this.context.isHost) {
            this.authoritativeHost.update(delta);
            return;
        }

        this.synchronizer.update(delta);
        this.updateLatencyProbe(delta);
    }

    public syncEntityNow(entityId: string, forceFullState: boolean = false): void {
        this.synchronizer.syncEntityNow(entityId, forceFullState);
    }

    public getDebugStatus(): {
        role: 'host' | 'guest';
        transport: 'peerjs' | 'relay' | 'disconnected';
        peers: number;
        sessionId: string | null;
        localPeerId: string | null;
        txBps: number;
        rxBps: number;
        txTotal: number;
        rxTotal: number;
        lastRttMs: number | null;
        avgRttMs: number | null;
        jitterMs: number | null;
        latencySamples: number;
    } {
        const metrics = this.context.runtime.diagnostics.getNetworkMetricsSnapshot();
        return {
            role: this.context.isHost ? 'host' : 'guest',
            transport: this.relaySocket
                ? 'relay'
                : (this.peer ? 'peerjs' : 'disconnected'),
            peers: this.connections.size,
            sessionId: this.context.sessionId,
            localPeerId: this.localPeerId || this.peer?.id || null,
            txBps: metrics.txBps,
            rxBps: metrics.rxBps,
            txTotal: metrics.txTotal,
            rxTotal: metrics.rxTotal,
            lastRttMs: metrics.lastRttMs,
            avgRttMs: metrics.avgRttMs,
            jitterMs: metrics.jitterMs,
            latencySamples: metrics.latencySamples
        };
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

    public requestScenarioAction(actionId: string, payload?: unknown): void {
        const scenario = this.context.runtime.session.getActiveScenario();
        const request: IScenarioActionRequestPayload = {
            scenarioId: scenario.id,
            actionId,
            payload
        };

        if (this.context.isHost) {
            const senderId = this.context.localPlayer?.id || this.localPeerId || this.peer?.id || null;
            const outcome = this.context.runtime.scenarioActions.executeHostRequest(senderId, request);
            if (outcome.executePayload) {
                this.broadcast(PACKET_TYPES.SCENARIO_ACTION_EXECUTE, outcome.executePayload);
            }
            this.context.runtime.scenarioActions.handleActionResult(outcome.resultPayload);
            return;
        }

        const sessionId = this.context.sessionId;
        if (!sessionId) {
            this.context.runtime.notify.warn('Cannot trigger scenario action while disconnected.', {
                source: 'scenario-action',
                code: 'scenario_action.disconnected'
            });
            return;
        }

        this.sendData(sessionId, PACKET_TYPES.SCENARIO_ACTION_REQUEST, request);
    }

    public applySessionConfigUpdate(payload: ISessionConfigUpdatePayload): void {
        if (this.context.isHost) {
            this.authoritativeHost.applySessionConfigUpdate(payload);
            return;
        }

        this.context.runtime.session.applySessionConfigUpdate(payload);
        this.broadcast(PACKET_TYPES.SESSION_CONFIG_UPDATE, { ...this.context.sessionConfig });
    }

    public handleHostPlayerInput(senderId: string, payload: IStateUpdatePacket[]): void {
        this.authoritativeHost.handlePlayerInput(senderId, payload);
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
            const incomingHeldBy = state.b ?? undefined;

            if (entity && source === 'player_input' && stateData.type !== EntityType.PLAYER_AVATAR) {
                const currentOwnerId = (entity as { ownerId?: string | null }).ownerId ?? null;

                if (this.context.isHost) {
                    if (currentOwnerId && senderId && currentOwnerId !== senderId) {
                        continue;
                    }

                    if (
                        currentOwnerId === null &&
                        incomingOwnerId !== undefined &&
                        incomingOwnerId === senderId &&
                        incomingHeldBy === senderId
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
        const data = JSON.stringify({ type, payload, senderId });
        for (const [peerId, conn] of this.connections.entries()) {
            if (conn.open && peerId !== senderId) {
                conn.send(data);
                this.context.runtime.diagnostics.recordNetworkSent(data.length);
            }
        }
    }

    public reclaimOwnership(peerId: string): void {
        if (this.context.isHost) {
            this.authoritativeHost.reclaimOwnership(peerId);
            return;
        }

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
        if (this.context.isHost) {
            this.authoritativeHost.handleOwnershipRequest(senderId, payload);
            return;
        }

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
        if (this.context.isHost) {
            this.authoritativeHost.handleOwnershipRelease(senderId, payload);
            return;
        }

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
        if (conn && conn.open) {
            const data = JSON.stringify({ type, payload });
            conn.send(data);
            this.context.runtime.diagnostics.recordNetworkSent(data.length);
        }
    }

    public broadcast(type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload });
        for (const conn of this.connections.values()) {
            if (conn.open) {
                conn.send(data);
                this.context.runtime.diagnostics.recordNetworkSent(data.length);
            }
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
        this.pendingLatencyProbes.clear();
        this.timeSinceLastProbe = 0;
        this.connections.clear();
        this.context.sessionId = null;
    }

    private updateLatencyProbe(delta: number): void {
        this.timeSinceLastProbe += delta;
        this.pruneStaleLatencyProbes();

        if (this.timeSinceLastProbe < this.probeIntervalSec) return;
        this.timeSinceLastProbe = 0;

        const hostId = this.context.sessionId;
        if (!hostId || this.connections.size === 0) return;

        const probeId = this.nextProbeId();
        const sentAt = this.nowMs();
        this.pendingLatencyProbes.set(probeId, sentAt);
        this.sendData(hostId, PACKET_TYPES.RTT_PING, {
            probeId,
            clientSentAt: sentAt
        });
    }

    private handleRttPong(payload: PacketPayloadMap[typeof PACKET_TYPES.RTT_PONG]): void {
        const sentAt = this.pendingLatencyProbes.get(payload.probeId);
        if (sentAt === undefined) return;

        this.pendingLatencyProbes.delete(payload.probeId);
        this.context.runtime.diagnostics.recordRoundTripTime(Math.max(0, this.nowMs() - sentAt));
        this.reportLatencyToHost();
    }

    private pruneStaleLatencyProbes(): void {
        const cutoff = this.nowMs() - this.maxProbeAgeMs;
        for (const [probeId, sentAt] of this.pendingLatencyProbes.entries()) {
            if (sentAt < cutoff) {
                this.pendingLatencyProbes.delete(probeId);
            }
        }
    }

    private nextProbeId(): string {
        this.probeSeq += 1;
        return `${this.getLocalTransportId()}:${this.probeSeq}`;
    }

    private reportLatencyToHost(): void {
        const hostId = this.context.sessionId;
        if (!hostId || this.context.isHost) return;

        const metrics = this.context.runtime.diagnostics.getNetworkMetricsSnapshot();
        if (metrics.lastRttMs === null) return;

        const payload: IPeerLatencyReportPayload = {
            lastRttMs: metrics.lastRttMs,
            avgRttMs: metrics.avgRttMs ?? undefined,
            jitterMs: metrics.jitterMs ?? undefined,
            samples: metrics.latencySamples,
            reportedAt: this.nowMs()
        };

        this.sendData(hostId, PACKET_TYPES.PEER_LATENCY_REPORT, payload);
    }

    private getLocalTransportId(): string {
        return this.localPeerId || this.peer?.id || this.context.localPlayer?.id || 'guest';
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
        this.context.runtime.diagnostics.record('error', 'network', `Peer error (${err?.type || 'unknown'})`);
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

    private noteIncomingTraffic(data: unknown): void {
        const bytes = this.measurePayloadSize(data);
        if (bytes > 0) {
            this.context.runtime.diagnostics.recordNetworkReceived(bytes);
        }
    }

    private measurePayloadSize(data: unknown): number {
        if (typeof data === 'string') {
            return data.length;
        }

        if (data instanceof ArrayBuffer) {
            return data.byteLength;
        }

        if (ArrayBuffer.isView(data)) {
            return data.byteLength;
        }

        try {
            return JSON.stringify(data).length;
        } catch {
            return 0;
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
