import { AppContext } from '../app/AppContext';
import { IUpdatable } from '../shared/contracts/IUpdatable';
import { PACKET_TYPES } from '../shared/constants/Constants';
import { NetworkDispatcher } from '../network/protocol/PacketDispatcher';
import { NetworkSynchronizer, INetworkTransport } from '../network/replication/StateSynchronizer';
import { IStateUpdatePacket, EntityType } from '../shared/contracts/IEntityState';
import { PacketPayloadMap } from '../network/protocol/PacketTypes';
import {
    IFeatureSnapshotRequestPayload,
    IOwnershipReleasePayload,
    IOwnershipRequestPayload,
    ISessionConfigUpdatePayload
} from '../shared/contracts/INetworkPacket';
import { IReplicatedFeatureEventPayload, IReplicatedFeatureSnapshotPayload } from '../network/replication/FeatureReplicationService';

export class ServerNetworkManager implements IUpdatable, INetworkTransport {
    private context!: AppContext;
    private dispatcher: NetworkDispatcher<PacketPayloadMap>;
    private synchronizer!: NetworkSynchronizer;
    public connections: Map<string, any> = new Map(); // peerId -> WebSocket
    private ownershipSeqByEntity: Map<string, number> = new Map();

    // Traffic metrics
    public bytesReceived: number = 0;
    public bytesSent: number = 0;

    constructor() {
        this.dispatcher = new NetworkDispatcher<PacketPayloadMap>();
    }

    public setContext(context: AppContext): void {
        this.context = context;
        this.synchronizer = new NetworkSynchronizer(this, this.context);

        // Register server handlers
        this.dispatcher.registerHandler(PACKET_TYPES.PLAYER_INPUT, {
            handle: (senderId: string, payload: IStateUpdatePacket[]) => {
                this.applyStateUpdate(payload);
                // Headless server broadcasts its own authoritative state via synchronizer.
                // We must relay avatars AND any objects the server has given ownership to!
                const relayPackets = payload.filter(p => {
                    if (p.type === EntityType.PLAYER_AVATAR) return true;
                    const entity = this.context.runtime.entity.getEntity(p.id);
                    return entity && !entity.isAuthority;
                });

                if (relayPackets.length > 0) {
                    this.relayToOthers(senderId, PACKET_TYPES.PLAYER_INPUT, relayPackets);
                }
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_REQUEST, {
            handle: (senderId: string, payload: IOwnershipRequestPayload) => {
                this.handleOwnershipRequest(senderId, payload);
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_RELEASE, {
            handle: (senderId: string, payload: IOwnershipReleasePayload) => {
                this.handleOwnershipRelease(senderId, payload);
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.FEATURE_EVENT, {
            handle: (senderId: string, payload: IReplicatedFeatureEventPayload) => {
                this.context.runtime.replication.handleIncomingFeatureEvent(senderId, payload);
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.FEATURE_SNAPSHOT_REQUEST, {
            handle: (senderId: string, payload: IFeatureSnapshotRequestPayload) => {
                this.context.runtime.replication.sendSnapshotToPeer(senderId);
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.FEATURE_SNAPSHOT, {
            handle: (_senderId: string, _payload: IReplicatedFeatureSnapshotPayload) => {
                // Host-owned source of truth; clients should not push snapshots upstream.
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.SESSION_CONFIG_UPDATE, {
            handle: (_senderId: string, payload: ISessionConfigUpdatePayload) => {
                this.applySessionConfigUpdate(payload);
            }
        });
    }

    public update(delta: number): void {
        if (this.synchronizer) {
            this.synchronizer.update(delta);
        }
    }

    public addClient(peerId: string, ws: any): void {
        this.connections.set(peerId, ws);

        const welcomeConfig = { ...this.context.sessionConfig, assignedSpawnIndex: this.connections.size };
        this.sendData(peerId, PACKET_TYPES.SESSION_CONFIG_UPDATE, welcomeConfig);

        const snapshot = this.context.runtime.entity.getWorldSnapshot();
        this.sendData(peerId, PACKET_TYPES.STATE_UPDATE, snapshot);
        this.context.runtime.replication.sendSnapshotToPeer(peerId);

        // Broadcast to everyone else that a new peer joined, so they can restart their media recorders to generate a fresh audio header
        this.relayToOthers(peerId, PACKET_TYPES.PEER_JOINED, { peerId });
    }

    public removeClient(peerId: string): void {
        this.connections.delete(peerId);
        this.reclaimOwnership(peerId);
        if (this.context.runtime.entity) {
            this.context.runtime.entity.removeEntity(peerId);
        }
        this.broadcast(PACKET_TYPES.PEER_DISCONNECT, peerId);
    }

    public handleMessage(peerId: string, messageData: any): void {
        if (messageData.type === PACKET_TYPES.AUDIO_CHUNK) {
            this.relayToOthers(peerId, PACKET_TYPES.AUDIO_CHUNK, messageData.payload);
            return;
        }
        this.dispatcher.dispatch(peerId, messageData);
        // Approximate byte size
        this.bytesReceived += JSON.stringify(messageData).length;
    }

    // --- INetworkTransport implementation ---
    public sendData(targetId: string, type: number, payload: unknown, senderId?: string): void {
        const ws = this.connections.get(targetId);
        if (ws && ws.readyState === 1) { // 1 = OPEN
            const data = JSON.stringify({ type, payload, senderId });
            ws.send(data);
            this.bytesSent += data.length;
        }
    }

    public broadcast(type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload });
        const dataLength = data.length;
        for (const ws of this.connections.values()) {
            if (ws?.readyState === 1) {
                ws.send(data);
                this.bytesSent += dataLength;
            }
        }
    }

    public relayToOthers(senderId: string, type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload, senderId }); // Inject senderId to identify source
        const dataLength = data.length;
        for (const [peerId, ws] of this.connections.entries()) {
            if (peerId !== senderId && ws?.readyState === 1) {
                ws.send(data);
                this.bytesSent += dataLength;
            }
        }
    }

    // --- State and Ownership Methods ---
    public applyStateUpdate(entityStates: IStateUpdatePacket[]): void {
        const runtime = this.context.runtime;
        for (const stateData of entityStates) {
            let entity = runtime.entity.getEntity(stateData.id);
            if (!entity) {
                const config = {
                    spawnPos: { x: 0, y: 0, z: 0 },
                    spawnYaw: 0,
                    isAuthority: false,
                    controlMode: stateData.type === EntityType.PLAYER_AVATAR ? 'remote' : undefined
                };
                entity = runtime.entity.discover(stateData.id, stateData.type, config) || undefined;
            }
            if (entity && !entity.isAuthority) {
                const networkable = entity as any;
                if (networkable.applyNetworkState) networkable.applyNetworkState(stateData.state);
            }
        }
    }

    public applySessionConfigUpdate(payload: ISessionConfigUpdatePayload): void {
        this.context.runtime.session.updateConfig(payload);
        this.broadcast(PACKET_TYPES.SESSION_CONFIG_UPDATE, { ...this.context.sessionConfig });
    }

    public reclaimOwnership(peerId: string): void {
        for (const entity of this.context.runtime.entity.entities.values()) {
            const logicEntity = entity as any;
            if (logicEntity.ownerId === peerId) {
                logicEntity.ownerId = null;
                if (logicEntity.heldBy !== undefined) logicEntity.heldBy = null;
                entity.isAuthority = true;
                const seq = this.nextOwnershipSeq(entity.id);
                this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: null, seq, sentAt: this.nowMs() });
            }
        }
    }

    public handleOwnershipRequest(senderId: string, payload: IOwnershipRequestPayload): void {
        const entity = this.context.runtime.entity.getEntity(payload.entityId);
        if (!entity) return;
        const logicEntity = entity as any;
        if (!logicEntity.ownerId || logicEntity.ownerId === senderId) {
            logicEntity.ownerId = senderId;
            entity.isAuthority = false; // Server gives up authority
            const seq = this.nextOwnershipSeq(entity.id);
            this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: senderId, seq, sentAt: this.nowMs() });
        }
    }

    public handleOwnershipRelease(senderId: string, payload: IOwnershipReleasePayload): void {
        const entity = this.context.runtime.entity.getEntity(payload.entityId);
        if (!entity) return;
        const logicEntity = entity as any;
        if (logicEntity.ownerId !== senderId) return;

        logicEntity.ownerId = null;
        entity.isAuthority = true; // Server reclaims authority

        if (logicEntity.onNetworkEvent) {
            logicEntity.onNetworkEvent('OWNERSHIP_RELEASE', payload);
        }

    }

    public broadcastNotification(message: string): void {
        this.broadcast(PACKET_TYPES.SESSION_NOTIFICATION, {
            kind: 'system',
            message: message,
            level: 'info',
            sentAt: this.nowMs()
        });
    }

    public spawnCube(): void {
        const sessionMgr = this.context.runtime.session;
        if (sessionMgr && sessionMgr.props) {
            sessionMgr.props.spawnGrabbableCube();
        }
    }

    public resetSession(): void {
        const entityMgr = this.context.runtime.entity;
        const entities = Array.from(entityMgr.entities.values());
        entities.forEach(entity => {
            if (entity.type === EntityType.PHYSICS_PROP) {
                entityMgr.removeEntity(entity.id);
            }
        });
        // Re-init the session props
        this.context.runtime.session.init(null as any);
        this.broadcast(PACKET_TYPES.STATE_UPDATE, entityMgr.getWorldSnapshot());
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
}
