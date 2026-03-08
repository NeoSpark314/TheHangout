import type * as THREE from 'three';
import type { IVector3 } from '../../shared/contracts/IMath';
import { EntityFactory } from '../../world/spawning/EntityFactory';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import type { IObjectSpawnContext } from '../contracts/IObjectModule';
import { BaseReplicatedObjectInstance } from './BaseReplicatedObjectInstance';

interface IReplicatedPhysicsPropInit {
    size: number;
    position: IVector3;
    mesh: THREE.Object3D;
    halfExtents?: IVector3;
    ownerId?: string | null;
    url?: string;
    entityId?: string;
}

export abstract class BaseReplicatedPhysicsPropObjectInstance extends BaseReplicatedObjectInstance {
    protected propEntity: PhysicsPropEntity | null = null;

    constructor(context: IObjectSpawnContext, moduleId: string, init: IReplicatedPhysicsPropInit) {
        super(context, moduleId);

        const entityId = (typeof init.entityId === 'string' && init.entityId.length > 0)
            ? init.entityId
            : this.id;

        this.propEntity = EntityFactory.createGrabbable(
            context.app,
            entityId,
            init.size,
            init.position,
            init.mesh as any,
            init.halfExtents,
            moduleId,
            init.ownerId,
            init.url
        );

        if (this.propEntity) {
            this.addCleanup(() => {
                if (this.propEntity) {
                    this.context.app.runtime.entity?.removeEntity(this.propEntity.id);
                }
            });
        }
    }

    public getPrimaryEntity(): PhysicsPropEntity | null {
        return this.propEntity;
    }
}
