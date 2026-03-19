import type { AppContext } from '../../app/AppContext';
import type { IScenarioReplicationEmitOptions, IReplicatedScenarioModule } from '../contracts/IReplicatedScenarioModule';
import { ScenarioReplicationChannel } from './ScenarioReplicationChannel';

export class ScenarioReplicationHost {
    private activeScenario: IReplicatedScenarioModule | null = null;
    private activeChannel: ScenarioReplicationChannel | null = null;

    constructor(private context: AppContext) { }

    public attach(scenario: IReplicatedScenarioModule): void {
        if (this.activeScenario?.replicationKey === scenario.replicationKey) {
            return;
        }

        this.detach();

        const channel = new ScenarioReplicationChannel(scenario);
        this.activeScenario = scenario;
        this.activeChannel = channel;
        this.context.runtime.replication.registerFeature(channel);
    }

    public detach(): void {
        if (this.activeChannel) {
            this.context.runtime.replication.unregisterFeature(this.activeChannel.featureId);
        }

        this.activeScenario = null;
        this.activeChannel = null;
    }

    public emit(eventType: string, data: unknown, options?: IScenarioReplicationEmitOptions): void {
        if (!this.activeScenario) return;
        this.context.runtime.replication.emitFeatureEvent(this.activeScenario.replicationKey, eventType, data, options);
    }
}
