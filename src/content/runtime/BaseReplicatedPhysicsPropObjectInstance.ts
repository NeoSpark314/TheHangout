import type * as THREE from 'three';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IVector3 } from '../../shared/contracts/IMath';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import type { IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import type { PhysicsReplicationProfileId } from '../../physics/runtime/PhysicsReplicationProfiles';
import { BaseReplicatedObjectInstance } from './BaseReplicatedObjectInstance';
import { ObjectRuntimeContext } from './ObjectRuntimeContext';
import { SharedPropHandle } from './SharedPropHandle';

interface IReplicatedPhysicsPropBaseInit {
    position: IVector3;
    mesh: THREE.Object3D;
    ownerId?: string | null;
    url?: string;
    entityId?: string;
    grabbable?: boolean;
    scale?: number;
    dualGrabScalable?: boolean;
    replicationProfileId?: PhysicsReplicationProfileId;
}

interface IReplicatedBoxPhysicsPropInit extends IReplicatedPhysicsPropBaseInit {
    shape?: 'box';
    size?: number;
    halfExtents?: IVector3;
}

interface IReplicatedSpherePhysicsPropInit extends IReplicatedPhysicsPropBaseInit {
    shape: 'sphere';
    radius?: number;
}

type IReplicatedPhysicsPropInit =
    | IReplicatedBoxPhysicsPropInit
    | IReplicatedSpherePhysicsPropInit;

export abstract class BaseReplicatedPhysicsPropObjectInstance extends BaseReplicatedObjectInstance {
    protected propHandle: SharedPropHandle | null = null;
    protected propEntity: PhysicsPropEntity | null = null;

    constructor(context: IObjectSpawnContext, moduleId: string, init: IReplicatedPhysicsPropInit) {
        super(context, moduleId);

        const entityId = (typeof init.entityId === 'string' && init.entityId.length > 0)
            ? init.entityId
            : this.id;

        const sharedPropInit = init.shape === 'sphere'
            ? {
                ...init,
                shape: 'sphere' as const,
                radius: init.radius ?? 0.09,
                entityId
            }
            : {
                ...init,
                shape: 'box' as const,
                size: init.size ?? 0.12,
                entityId
            };

        const handle = this.context.props.spawnShared({
            ...sharedPropInit,
            profile: sharedPropInit.replicationProfileId
        }) as SharedPropHandle | null;
        this.propHandle = handle;
        this.propEntity = handle?.getEntity() ?? null;

        if (this.propEntity) {
            this.addCleanup(() => {
                if (this.propEntity && this.context instanceof ObjectRuntimeContext) {
                    this.context.removeEntity(this.propEntity.id);
                }
            });
        }
    }

    public getPrimaryEntity(): IEntity | null {
        return this.propEntity;
    }

    public onReplicationEvent(_eventType: string, _data: unknown, _meta: IObjectReplicationMeta): void { }
}
