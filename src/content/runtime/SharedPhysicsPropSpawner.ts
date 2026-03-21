import type * as THREE from 'three';
import { EntityFactory } from '../../world/spawning/EntityFactory';
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { IObjectSpawnContext } from '../contracts/IObjectModule';
import type { PhysicsReplicationProfileId } from '../../physics/runtime/PhysicsReplicationProfiles';

interface ISharedPhysicsPropSpawnBase {
    position: IVector3;
    mesh: THREE.Object3D;
    ownerId?: string | null;
    url?: string;
    entityId?: string;
    scale?: number;
    dualGrabScalable?: boolean;
    replicationProfileId?: PhysicsReplicationProfileId;
}

export interface IBoxSharedPhysicsPropSpawnInit extends ISharedPhysicsPropSpawnBase {
    shape?: 'box';
    size: number;
    halfExtents?: IVector3;
}

export interface ISphereSharedPhysicsPropSpawnInit extends ISharedPhysicsPropSpawnBase {
    shape: 'sphere';
    radius: number;
}

export type SharedPhysicsPropSpawnInit =
    | IBoxSharedPhysicsPropSpawnInit
    | ISphereSharedPhysicsPropSpawnInit;

export function spawnSharedPhysicsProp(
    context: IObjectSpawnContext,
    moduleId: string,
    init: SharedPhysicsPropSpawnInit
): PhysicsPropEntity | null {
    const entityId = (typeof init.entityId === 'string' && init.entityId.length > 0)
        ? init.entityId
        : context.instanceId;

    if (init.shape === 'sphere') {
        return EntityFactory.createSphereGrabbable(
            context.app,
            entityId,
            init.radius,
            init.position,
            init.mesh as any,
            moduleId,
            init.ownerId,
            init.replicationProfileId
        );
    }

    return EntityFactory.createGrabbable(
        context.app,
        entityId,
        init.size,
        init.position,
        init.mesh as any,
        init.halfExtents,
        moduleId,
        init.ownerId,
        init.url,
        init.scale,
        init.dualGrabScalable,
        init.replicationProfileId
    );
}
