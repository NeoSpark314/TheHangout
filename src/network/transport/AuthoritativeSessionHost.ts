import { AppContext } from '../../app/AppContext';
import { NetworkDispatcher } from '../protocol/PacketDispatcher';
import { PacketPayloadMap } from '../protocol/PacketTypes';
import { NetworkSynchronizer, INetworkTransport } from '../replication/StateSynchronizer';
import { PACKET_TYPES } from '../../shared/constants/Constants';
import { EntityType, IStateUpdatePacket } from '../../shared/contracts/IEntityState';
import {
    IFeatureSnapshotRequestPayload,
    IPeerLatencyReportPayload,
    IRttPingPayload,
    IOwnershipReleasePayload,
    IOwnershipRequestPayload,
    IScenarioActionRequestPayload,
    ISessionConfigUpdatePayload
} from '../../shared/contracts/INetworkPacket';
import {
    IReplicatedFeatureEventPayload,
    IReplicatedFeatureSnapshotPayload
} from '../replication/FeatureReplicationService';

export interface IAuthoritativeHostTransport extends INetworkTransport {
    relayToOthers(senderId: string, type: number, payload: unknown): void;
}

/**
 * Shared host-only rules for authoritative session sync.
 *
 * Both PeerJS host mode and the dedicated WebSocket server should behave the same
 * for ownership, state acceptance, snapshot delivery, and feature fan-out.
 * Keeping those rules here reduces the chance that one transport drifts after a
 * gameplay or physics refactor.
 */
export class AuthoritativeSessionHost {
    private readonly synchronizer: NetworkSynchronizer;
    private readonly ownershipSeqByEntity: Map<string, number> = new Map();

    constructor(
        private context: AppContext,
        private transport: IAuthoritativeHostTransport
    ) {
        this.synchronizer = new NetworkSynchronizer(this.transport, this.context);
    }

    public registerHandlers(dispatcher: NetworkDispatcher<PacketPayloadMap>): void {
        dispatcher.registerHandler(PACKET_TYPES.PLAYER_INPUT, {
            handle: (senderId: string, payload: IStateUpdatePacket[]) => {
                this.handlePlayerInput(senderId, payload);
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_REQUEST, {
            handle: (senderId: string, payload: IOwnershipRequestPayload) => {
                this.handleOwnershipRequest(senderId, payload);
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_RELEASE, {
            handle: (senderId: string, payload: IOwnershipReleasePayload) => {
                this.handleOwnershipRelease(senderId, payload);
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.FEATURE_EVENT, {
            handle: (senderId: string, payload: IReplicatedFeatureEventPayload) => {
                this.context.runtime.replication.handleIncomingFeatureEvent(senderId, payload);
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.FEATURE_SNAPSHOT_REQUEST, {
            handle: (senderId: string, _payload: IFeatureSnapshotRequestPayload) => {
                this.context.runtime.replication.sendSnapshotToPeer(senderId);
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.FEATURE_SNAPSHOT, {
            handle: (_senderId: string, _payload: IReplicatedFeatureSnapshotPayload) => {
                // Host is authoritative for late-join snapshots; clients should not send them upstream.
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.SESSION_CONFIG_UPDATE, {
            handle: (_senderId: string, payload: ISessionConfigUpdatePayload) => {
                this.applySessionConfigUpdate(payload);
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.RTT_PING, {
            handle: (senderId: string, payload: IRttPingPayload) => {
                this.handleRttPing(senderId, payload);
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.PEER_LATENCY_REPORT, {
            handle: (senderId: string, payload: IPeerLatencyReportPayload) => {
                this.handlePeerLatencyReport(senderId, payload);
            }
        });

        dispatcher.registerHandler(PACKET_TYPES.SCENARIO_ACTION_REQUEST, {
            handle: (senderId: string, payload: IScenarioActionRequestPayload) => {
                this.handleScenarioActionRequest(senderId, payload);
            }
        });
    }

    public update(delta: number): void {
        this.synchronizer.update(delta);
    }

    public sendWelcomeState(peerId: string, assignedSpawnIndex: number): void {
        const welcomeConfig = {
            ...this.context.sessionConfig,
            assignedSpawnIndex
        };

        this.transport.sendData(peerId, PACKET_TYPES.SESSION_CONFIG_UPDATE, welcomeConfig);

        const snapshot = this.context.runtime.entity.getWorldSnapshot();
        this.transport.sendData(peerId, PACKET_TYPES.STATE_UPDATE, snapshot);
        this.context.runtime.replication.sendSnapshotToPeer(peerId);
    }

    public notifyPeerJoined(peerId: string): void {
        // Existing clients use this to refresh transport-bound state such as voice headers.
        this.transport.relayToOthers(peerId, PACKET_TYPES.PEER_JOINED, { peerId });
    }

    public notifyPeerDisconnected(peerId: string): void {
        this.transport.broadcast(PACKET_TYPES.PEER_DISCONNECT, peerId);
    }

    public handlePlayerInput(senderId: string, payload: IStateUpdatePacket[]): void {
        this.applyStateUpdate(payload, senderId);

        const relayPackets = this.filterRelayedPlayerInput(payload);
        if (relayPackets.length > 0) {
            this.transport.relayToOthers(senderId, PACKET_TYPES.PLAYER_INPUT, relayPackets);
        }
    }

    public applyStateUpdate(entityStates: IStateUpdatePacket[], senderId?: string): void {
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

            const state = stateData.state as { ownerId?: string | null; o?: string | null; b?: string | null };
            const hasOwnershipHint = state.ownerId !== undefined || state.o !== undefined;
            const incomingOwnerId = hasOwnershipHint
                ? (state.ownerId !== undefined ? state.ownerId : state.o)
                : undefined;
            const incomingHeldBy = state.b ?? undefined;

            if (entity && stateData.type !== EntityType.PLAYER_AVATAR) {
                const currentOwnerId = (entity as { ownerId?: string | null }).ownerId ?? null;

                // Only the current owner may drive the prop while ownership is leased.
                if (currentOwnerId && senderId && currentOwnerId !== senderId) {
                    continue;
                }

                // Allow the first packet after a local claim to establish owner identity on the host,
                // but only while the sender is actively holding the prop. Without the heldBy guard,
                // a late post-release packet can silently reclaim ownership after the host already
                // accepted the release, which leaves tools like the pen stuck with a stale owner.
                if (
                    currentOwnerId === null &&
                    incomingOwnerId !== undefined &&
                    incomingOwnerId === senderId &&
                    incomingHeldBy === senderId
                ) {
                    (entity as { ownerId?: string | null }).ownerId = incomingOwnerId;
                    entity.isAuthority = false;
                }
            }

            if (entity && !entity.isAuthority) {
                const networkable = entity as { applyNetworkState?: (state: unknown) => void };
                networkable.applyNetworkState?.(stateData.state);
            }
        }
    }

    public applySessionConfigUpdate(payload: ISessionConfigUpdatePayload): void {
        let broadcastDone = false;
        const broadcastAfterApply = () => {
            if (broadcastDone) return;
            broadcastDone = true;
            this.transport.broadcast(PACKET_TYPES.SESSION_CONFIG_UPDATE, { ...this.context.sessionConfig });
            this.broadcastAuthoritativeWorldState();
        };

        const previousScenarioId = this.context.sessionConfig.activeScenarioId;
        const scenarioChangeRequested = typeof payload.activeScenarioId === 'string'
            && payload.activeScenarioId !== previousScenarioId;
        if (scenarioChangeRequested) {
            const targetScenarioId = payload.activeScenarioId as string;
            const targetScenario = this.context.runtime.session.getAvailableScenarios()
                .find((scenario) => scenario.id === targetScenarioId);
            const targetLabel = targetScenario?.displayName || targetScenarioId;
            this.transport.broadcast(PACKET_TYPES.SESSION_NOTIFICATION, {
                kind: 'system',
                level: 'info',
                message: `Teleporting to ${targetLabel}...`,
                sentAt: this.nowMs()
            });
        }

        const applied = this.context.runtime.session.applySessionConfigUpdate(payload, () => {
            broadcastAfterApply();
        });
        if (!applied) {
            if (payload.activeScenarioId) {
                console.warn(
                    `[AuthoritativeSessionHost] Rejected session config update` +
                    ` (activeScenarioId=${payload.activeScenarioId})`
                );
            }
            return;
        }

        // Non-scenario updates apply synchronously and can broadcast immediately.
        if (!scenarioChangeRequested) {
            broadcastAfterApply();
        }
    }

    public reclaimOwnership(peerId: string): void {
        for (const entity of this.context.runtime.entity.entities.values()) {
            const logicEntity = entity as {
                ownerId?: string | null;
                heldBy?: string | null;
            };

            if (logicEntity.ownerId !== peerId) continue;

            logicEntity.ownerId = null;
            if (logicEntity.heldBy !== undefined) {
                logicEntity.heldBy = null;
            }

            entity.isAuthority = true;

            const seq = this.nextOwnershipSeq(entity.id);
            this.transport.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, {
                entityId: entity.id,
                newOwnerId: null,
                seq,
                sentAt: this.nowMs()
            });
        }
    }

    public handleOwnershipRequest(senderId: string, payload: IOwnershipRequestPayload): void {
        const entity = this.context.runtime.entity.getEntity(payload.entityId);
        if (!entity) return;

        const logicEntity = entity as {
            ownerId?: string | null;
            onNetworkEvent?: (type: string, data: unknown) => void;
        };

        if (logicEntity.ownerId && logicEntity.ownerId !== senderId) return;

        logicEntity.ownerId = senderId;
        entity.isAuthority = false;

        const seq = this.nextOwnershipSeq(entity.id);
        const transferPayload = {
            entityId: entity.id,
            newOwnerId: senderId,
            seq,
            sentAt: this.nowMs()
        };

        logicEntity.onNetworkEvent?.('OWNERSHIP_TRANSFER', transferPayload);
        this.transport.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, transferPayload);
    }

    public handleOwnershipRelease(senderId: string, payload: IOwnershipReleasePayload): void {
        const entity = this.context.runtime.entity.getEntity(payload.entityId);
        if (!entity) return;

        const logicEntity = entity as {
            ownerId?: string | null;
            onNetworkEvent?: (type: string, data: unknown) => void;
        };

        if (logicEntity.ownerId !== senderId) return;

        logicEntity.ownerId = null;
        entity.isAuthority = true;

        logicEntity.onNetworkEvent?.('OWNERSHIP_RELEASE', payload);

        const seq = this.nextOwnershipSeq(entity.id);
        this.transport.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, {
            entityId: entity.id,
            newOwnerId: null,
            seq,
            sentAt: this.nowMs()
        });
    }

    public handleRttPing(senderId: string, payload: IRttPingPayload): void {
        const serverReceivedAt = this.nowMs();
        this.transport.sendData(senderId, PACKET_TYPES.RTT_PONG, {
            probeId: payload.probeId,
            clientSentAt: payload.clientSentAt,
            serverReceivedAt,
            serverSentAt: this.nowMs()
        });
    }

    public handlePeerLatencyReport(senderId: string, payload: IPeerLatencyReportPayload): void {
        const transport = this.transport as {
            handlePeerLatencyReport?: (peerId: string, payload: IPeerLatencyReportPayload) => void;
        };
        transport.handlePeerLatencyReport?.(senderId, payload);
    }

    public handleScenarioActionRequest(senderId: string, payload: IScenarioActionRequestPayload): void {
        const outcome = this.context.runtime.scenarioActions.executeHostRequest(senderId, payload);
        this.transport.sendData(senderId, PACKET_TYPES.SCENARIO_ACTION_RESULT, outcome.resultPayload);
        if (outcome.executePayload) {
            this.transport.broadcast(PACKET_TYPES.SCENARIO_ACTION_EXECUTE, outcome.executePayload);
        }
    }

    private filterRelayedPlayerInput(payload: IStateUpdatePacket[]): IStateUpdatePacket[] {
        return payload.filter((packet) => {
            if (packet.type === EntityType.PLAYER_AVATAR) return true;

            const entity = this.context.runtime.entity.getEntity(packet.id);
            return !!entity && !entity.isAuthority;
        });
    }

    private nextOwnershipSeq(entityId: string): number {
        const next = (this.ownershipSeqByEntity.get(entityId) ?? 0) + 1;
        this.ownershipSeqByEntity.set(entityId, next);
        return next;
    }

    private broadcastAuthoritativeWorldState(): void {
        const fullSnapshot = this.context.runtime.entity.getWorldSnapshot();
        if (fullSnapshot.length > 0) {
            // After a scenario/config transition, push a full authoritative snapshot
            // immediately so all guests converge on the new world in one step.
            this.transport.broadcast(PACKET_TYPES.STATE_UPDATE, fullSnapshot);
        }

        const featureSnapshot = this.context.runtime.replication.createSnapshotPayload();
        this.transport.broadcast(PACKET_TYPES.FEATURE_SNAPSHOT, featureSnapshot);
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
