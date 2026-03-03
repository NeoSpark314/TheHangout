import type { AppContext } from '../../app/AppContext';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IReplicatedObjectInstance } from '../contracts/IReplicatedObjectInstance';
import type { ISpawnedObjectInstance } from '../contracts/ISpawnedObjectInstance';
import { ObjectReplicationHost } from './ObjectReplicationHost';

function isReplicatedObjectInstance(instance: ISpawnedObjectInstance): instance is IReplicatedObjectInstance {
    return typeof (instance as IReplicatedObjectInstance).replicationKey === 'string'
        && typeof (instance as IReplicatedObjectInstance).onReplicationEvent === 'function';
}

export class ObjectInstanceRegistry {
    private readonly instances = new Map<string, ISpawnedObjectInstance>();
    private readonly replicationHost: ObjectReplicationHost;

    constructor(private context: AppContext) {
        this.replicationHost = new ObjectReplicationHost(context);
    }

    public add(instance: ISpawnedObjectInstance): void {
        const existing = this.instances.get(instance.id);
        if (existing && existing !== instance) {
            this.remove(instance.id);
        }

        this.instances.set(instance.id, instance);

        const primaryEntity = instance.getPrimaryEntity?.();
        if (primaryEntity) {
            this.context.runtime.entity.addEntity(primaryEntity);
        }

        if (isReplicatedObjectInstance(instance)) {
            this.replicationHost.attach(instance);
        }
    }

    public remove(instanceId: string): void {
        const instance = this.instances.get(instanceId);
        if (!instance) return;

        this.replicationHost.detach(instanceId);

        const primaryEntity = instance.getPrimaryEntity?.() ?? null;
        const ownedEntityIds = new Set<string>(instance.getOwnedEntityIds?.() ?? []);
        if (primaryEntity) {
            ownedEntityIds.add(primaryEntity.id);
        }

        instance.destroy();

        for (const entityId of ownedEntityIds) {
            const entity = this.context.runtime.entity.getEntity(entityId) as IEntity | undefined;
            if (!entity) continue;

            if (entity.isDestroyed) {
                this.context.runtime.entity.entities.delete(entityId);
            } else {
                this.context.runtime.entity.removeEntity(entityId);
            }
        }

        this.instances.delete(instanceId);
    }

    public removeAll(): void {
        for (const instanceId of Array.from(this.instances.keys())) {
            this.remove(instanceId);
        }
    }

    public get(instanceId: string): ISpawnedObjectInstance | undefined {
        return this.instances.get(instanceId);
    }

    public list(): ISpawnedObjectInstance[] {
        return Array.from(this.instances.values());
    }

    public update(delta: number): void {
        for (const [instanceId, instance] of this.instances.entries()) {
            try {
                instance.update(delta);
            } catch (error) {
                console.error(`[ObjectInstanceRegistry] Error updating object instance ${instanceId}:`, error);
            }
        }
    }

    public emit(instanceId: string, eventType: string, data: unknown): void {
        this.replicationHost.emit(instanceId, eventType, data);
    }
}
