import type { AppContext } from '../../app/AppContext';
import type { IObjectReplicationEmitOptions } from '../contracts/IReplicatedObjectInstance';
import type { IReplicatedObjectInstance } from '../contracts/IReplicatedObjectInstance';
import { ObjectReplicationChannel } from './ObjectReplicationChannel';

export class ObjectReplicationHost {
    private readonly instances = new Map<string, IReplicatedObjectInstance>();
    private readonly channels = new Map<string, ObjectReplicationChannel>();

    constructor(private context: AppContext) { }

    public attach(instance: IReplicatedObjectInstance): void {
        const existing = this.instances.get(instance.id);
        if (existing?.replicationKey === instance.replicationKey) {
            return;
        }

        if (existing) {
            this.detach(instance.id);
        }

        const channel = new ObjectReplicationChannel(instance);
        this.instances.set(instance.id, instance);
        this.channels.set(instance.id, channel);
        this.context.runtime.replication.registerFeature(channel);
    }

    public detach(instanceId: string): void {
        const instance = this.instances.get(instanceId);
        const channel = this.channels.get(instanceId);
        if (instance && channel) {
            this.context.runtime.replication.unregisterFeature(channel.featureId);
        }

        this.instances.delete(instanceId);
        this.channels.delete(instanceId);
    }

    public emit(instanceId: string, eventType: string, data: unknown, options?: IObjectReplicationEmitOptions): void {
        const instance = this.instances.get(instanceId);
        if (!instance) return;
        this.context.runtime.replication.emitFeatureEvent(instance.replicationKey, eventType, data, options);
    }
}
