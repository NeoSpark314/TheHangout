import type { IFeatureReplicationPolicy, IReplicatedFeature } from '../../network/replication/FeatureReplicationService';
import type { IReplicatedScenarioModule } from '../contracts/IReplicatedScenarioModule';

export class ScenarioReplicationChannel implements IReplicatedFeature {
    public readonly featureId: string;
    public readonly policy: IFeatureReplicationPolicy;

    constructor(private scenario: IReplicatedScenarioModule) {
        this.featureId = scenario.replicationKey;
        this.policy = {
            relayIncomingFromPeer: scenario.replicationPolicy?.relayIncomingFromPeer ?? 'others',
            includeInSnapshot: scenario.replicationPolicy?.includeInSnapshot ?? true,
            defaultLocalEcho: scenario.replicationPolicy?.defaultLocalEcho ?? true
        };
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
        this.scenario.onScenarioReplicationEvent(eventType, data, meta);
    }

    public captureSnapshot?(): unknown {
        return this.scenario.captureScenarioReplicationSnapshot?.();
    }

    public applySnapshot?(snapshot: unknown): void {
        this.scenario.applyScenarioReplicationSnapshot?.(snapshot);
    }
}
