import type { AppContext } from '../../app/AppContext';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IObjectModule, IObjectSpawnConfig } from '../contracts/IObjectModule';
import type { ISpawnedObjectInstance } from '../contracts/ISpawnedObjectInstance';
import { ObjectRuntimeContext } from './ObjectRuntimeContext';

class EntityBackedObjectInstance implements ISpawnedObjectInstance {
    constructor(
        private app: AppContext,
        public readonly id: string,
        public readonly moduleId: string,
        private entity: IEntity
    ) { }

    public getPrimaryEntity(): IEntity {
        return this.entity;
    }

    public update(): void { }

    public destroy(): void {
        const physicsEntity = this.entity as { rigidBody?: unknown };
        if (physicsEntity.rigidBody) {
            // Engine-level physics entities wrapped as object instances still own
            // Rapier bodies. Remove them here so scenario unload does not leave
            // stale colliders/bodies behind across scenario switches.
            this.app.runtime.physics.removeRigidBody(physicsEntity.rigidBody as any);
        }
        this.entity.destroy();
    }
}

function isSpawnedObjectInstance(value: unknown): value is ISpawnedObjectInstance {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as ISpawnedObjectInstance;
    return typeof candidate.id === 'string'
        && typeof candidate.moduleId === 'string'
        && typeof candidate.update === 'function'
        && typeof candidate.destroy === 'function';
}

export class ObjectModuleRegistry {
    private readonly modules = new Map<string, IObjectModule>();

    public replaceAll(nextModules: IObjectModule[]): void {
        this.modules.clear();
        for (const module of nextModules) {
            this.modules.set(module.id, module);
        }
    }

    public register(module: IObjectModule): void {
        this.modules.set(module.id, module);
    }

    public get(id: string): IObjectModule | undefined {
        return this.modules.get(id);
    }

    public list(): IObjectModule[] {
        return Array.from(this.modules.values());
    }

    public listIds(): string[] {
        return Array.from(this.modules.keys());
    }

    public spawn(moduleId: string, app: AppContext, config: IObjectSpawnConfig): ISpawnedObjectInstance | null {
        const module = this.modules.get(moduleId);
        if (!module) return null;

        const instanceId = config.id || `${moduleId}-${Math.random().toString(36).slice(2, 8)}`;
        const result = module.spawn(new ObjectRuntimeContext(app, instanceId), config);
        if (!result) return null;

        if (isSpawnedObjectInstance(result)) {
            return result;
        }

        const entity = result as IEntity;
        return new EntityBackedObjectInstance(app, entity.id, moduleId, entity);
    }
}
