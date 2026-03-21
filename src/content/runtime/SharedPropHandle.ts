import type { AppContext } from '../../app/AppContext';
import type {
    IObjectRuntimeContext,
    ISharedPropHandle
} from '../contracts/IObjectRuntimeContext';
import { EntityType } from '../../shared/contracts/IEntityState';
import type { IVector3 } from '../../shared/contracts/IMath';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';

export class SharedPropHandle implements ISharedPropHandle {
    public readonly id: string;

    constructor(
        private readonly context: AppContext,
        public readonly entityId: string
    ) {
        this.id = entityId;
    }

    public isAuthority(): boolean {
        return this.getEntity()?.isAuthority ?? false;
    }

    public getOwnerId(): string | null {
        return this.getEntity()?.ownerId ?? null;
    }

    public getHeldBy(): string | null {
        return this.getEntity()?.heldBy ?? null;
    }

    public getPosition(): IVector3 | null {
        const entity = this.getEntity();
        if (!entity?.rigidBody) return null;
        const position = entity.rigidBody.translation();
        return { x: position.x, y: position.y, z: position.z };
    }

    public getLinearVelocity(): IVector3 | null {
        const entity = this.getEntity();
        if (!entity?.rigidBody) return null;
        const velocity = entity.rigidBody.linvel();
        return { x: velocity.x, y: velocity.y, z: velocity.z };
    }

    public setBaseHalfExtents(halfExtents: IVector3): void {
        this.getEntity()?.setBaseHalfExtents(halfExtents);
    }

    public setUniformScale(scale: number): void {
        this.getEntity()?.setUniformScale(scale);
    }

    public syncNow(forceFullState?: boolean): void {
        this.context.runtime.network?.syncEntityNow(this.entityId, !!forceFullState);
    }

    public destroy(): void {
        const entity = this.getEntity();
        if (!entity) return;

        this.context.runtime.physics.removeRigidBody(entity.rigidBody);
        this.context.runtime.entity.removeEntity(entity.id);
    }

    public getEntity(): PhysicsPropEntity | null {
        const entity = this.context.runtime.entity.getEntity(this.entityId);
        if (!entity || entity.type !== EntityType.PHYSICS_PROP) return null;
        return entity as PhysicsPropEntity;
    }
}

export function resolveSharedPropHandle(
    context: AppContext,
    target: string | ISharedPropHandle | null | undefined
): SharedPropHandle | null {
    if (!target) return null;
    const entityId = typeof target === 'string' ? target : target.entityId;
    if (typeof entityId !== 'string' || entityId.length === 0) return null;
    const handle = new SharedPropHandle(context, entityId);
    return handle.getEntity() ? handle : null;
}

export function createSharedPropHandle(
    runtimeContext: IObjectRuntimeContext,
    entityId: string
): ISharedPropHandle | null {
    const objectRuntimeContext = runtimeContext as unknown as { getAppContext(): AppContext };
    const app = objectRuntimeContext.getAppContext?.();
    if (!app) return null;
    return resolveSharedPropHandle(app, entityId);
}
