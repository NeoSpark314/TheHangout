import type { IReplicatedFeature } from '../../network/replication/FeatureReplicationService';
import type { IReplicatedObjectInstance } from '../contracts/IReplicatedObjectInstance';

export class ObjectReplicationChannel implements IReplicatedFeature {
    public readonly featureId: string;

    constructor(private instance: IReplicatedObjectInstance) {
        this.featureId = instance.replicationKey;
    }

    public onEvent(
        eventType: string,
        data: unknown,
        meta: {
            eventId: string;
            originPeerId: string;
            senderId: string | null;
            local: boolean;
            sentAt: number;
        }
    ): void {
        this.instance.onReplicationEvent(eventType, data, meta);
    }

    public captureSnapshot?(): unknown {
        return this.instance.captureReplicationSnapshot?.();
    }

    public applySnapshot?(snapshot: unknown): void {
        this.instance.applyReplicationSnapshot?.(snapshot);
    }
}
