import { AppContext } from '../../app/AppContext';
import { PACKET_TYPES } from '../../shared/constants/Constants';

/**
 * Generic low/medium-frequency feature replication channel.
 *
 * Intended for:
 * - semantic events (e.g. drum hits, interaction triggers)
 * - snapshotable feature state for late joiners (e.g. drawing history)
 *
 * Not intended for:
 * - high-frequency continuous transforms (physics bodies, avatar/head/hands)
 *   which are handled by specialized sync pipelines with tighter cadence and
 *   ownership/interpolation logic.
 */
export interface IReplicatedFeatureEventPayload {
    featureId: string;
    eventType: string;
    eventId: string;
    originPeerId: string;
    sentAt: number;
    data: unknown;
}

export interface IReplicatedFeatureSnapshotEntry {
    featureId: string;
    snapshot: unknown;
}

export interface IReplicatedFeatureSnapshotPayload {
    features: IReplicatedFeatureSnapshotEntry[];
}

export interface IReplicatedFeature {
    featureId: string;
    onEvent(eventType: string, data: unknown, meta: {
        eventId: string;
        originPeerId: string;
        senderId: string | null;
        local: boolean;
        sentAt: number;
    }): void;
    captureSnapshot?(): unknown;
    applySnapshot?(snapshot: unknown): void;
}

export class FeatureReplicationService {
    private features: Map<string, IReplicatedFeature> = new Map();
    private pendingSnapshots: Map<string, unknown> = new Map();
    private eventSeq: number = 0;
    private seenEventIds: Set<string> = new Set();
    private seenEventQueue: string[] = [];
    private maxSeenEventIds: number = 4096;

    constructor(private context: AppContext) { }

    public registerFeature(feature: IReplicatedFeature): void {
        this.features.set(feature.featureId, feature);
        const pendingSnapshot = this.pendingSnapshots.get(feature.featureId);
        if (pendingSnapshot !== undefined && feature.applySnapshot) {
            feature.applySnapshot(pendingSnapshot);
            this.pendingSnapshots.delete(feature.featureId);
        }
    }

    public unregisterFeature(featureId: string): void {
        this.features.delete(featureId);
    }

    /**
     * Feature-scoped replication entry point.
     *
     * Use this for session/item-specific domain behavior (for example, a drum hit,
     * a puzzle trigger, or a drawing segment). This keeps those semantics out of
     * the global app EventBus, which should remain reserved for shared
     * infrastructure and lifecycle events.
     */
    public emitFeatureEvent(featureId: string, eventType: string, data: unknown): void {
        const payload: IReplicatedFeatureEventPayload = {
            featureId,
            eventType,
            eventId: this.nextEventId(),
            originPeerId: this.getLocalPeerId(),
            sentAt: this.nowMs(),
            data
        };

        this.applyEvent(payload, null, true);

        const network = this.context.runtime.network as unknown as {
            sendData: (targetId: string, type: number, payload: unknown) => void;
            broadcast: (type: number, payload: unknown) => void;
        } | undefined;
        if (!network) return;

        if (this.context.isHost) {
            network.broadcast(PACKET_TYPES.FEATURE_EVENT, payload);
            return;
        }

        const hostId = this.context.sessionId;
        if (hostId) {
            network.sendData(hostId, PACKET_TYPES.FEATURE_EVENT, payload);
        }
    }

    public handleIncomingFeatureEvent(senderId: string, payload: IReplicatedFeatureEventPayload): void {
        if (this.context.isHost) {
            const network = this.context.runtime.network as unknown as {
                relayToOthers?: (senderId: string, type: number, payload: unknown) => void;
            } | undefined;
            network?.relayToOthers?.(senderId, PACKET_TYPES.FEATURE_EVENT, payload);
        }

        this.applyEvent(payload, senderId, false);
    }

    public createSnapshotPayload(): IReplicatedFeatureSnapshotPayload {
        const features: IReplicatedFeatureSnapshotEntry[] = [];
        for (const feature of this.features.values()) {
            if (!feature.captureSnapshot) continue;
            const snapshot = feature.captureSnapshot();
            if (snapshot === undefined) {
                continue;
            }
            features.push({
                featureId: feature.featureId,
                snapshot
            });
        }
        return { features };
    }

    public applySnapshotPayload(payload: IReplicatedFeatureSnapshotPayload | undefined | null): void {
        if (!payload || !Array.isArray(payload.features)) return;
        for (const entry of payload.features) {
            const feature = this.features.get(entry.featureId);
            if (!feature?.applySnapshot) {
                this.pendingSnapshots.set(entry.featureId, entry.snapshot);
                continue;
            }
            feature.applySnapshot(entry.snapshot);
        }
    }

    public sendSnapshotToPeer(peerId: string): void {
        const network = this.context.runtime.network as unknown as {
            sendData: (targetId: string, type: number, payload: unknown) => void;
        } | undefined;
        if (!network) return;
        const payload = this.createSnapshotPayload();
        network.sendData(peerId, PACKET_TYPES.FEATURE_SNAPSHOT, payload);
    }

    public requestSnapshotFromHost(): void {
        if (this.context.isHost) return;
        const hostId = this.context.sessionId;
        if (!hostId) return;

        const network = this.context.runtime.network as unknown as {
            sendData: (targetId: string, type: number, payload: unknown) => void;
        } | undefined;
        if (!network) return;
        network.sendData(hostId, PACKET_TYPES.FEATURE_SNAPSHOT_REQUEST, {});
    }

    private applyEvent(payload: IReplicatedFeatureEventPayload, senderId: string | null, local: boolean): void {
        if (!payload || !payload.eventId || this.hasSeen(payload.eventId)) return;
        this.markSeen(payload.eventId);

        const feature = this.features.get(payload.featureId);
        if (!feature) return;

        feature.onEvent(payload.eventType, payload.data, {
            eventId: payload.eventId,
            originPeerId: payload.originPeerId,
            senderId,
            local,
            sentAt: payload.sentAt
        });
    }

    private nextEventId(): string {
        const id = this.getLocalPeerId();
        const seq = ++this.eventSeq;
        return `${id}:${seq}:${Math.floor(this.nowMs())}`;
    }

    private hasSeen(eventId: string): boolean {
        return this.seenEventIds.has(eventId);
    }

    private markSeen(eventId: string): void {
        this.seenEventIds.add(eventId);
        this.seenEventQueue.push(eventId);
        while (this.seenEventQueue.length > this.maxSeenEventIds) {
            const old = this.seenEventQueue.shift();
            if (old) this.seenEventIds.delete(old);
        }
    }

    private getLocalPeerId(): string {
        return this.context.localPlayer?.id
            || this.context.sessionId
            || 'local';
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
