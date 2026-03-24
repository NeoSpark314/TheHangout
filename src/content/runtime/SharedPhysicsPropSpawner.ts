import type * as THREE from 'three';
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import type { IMovableHoldable } from '../../shared/contracts/IMovableHoldable';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { ISharedPropSpawnOptions } from '../contracts/IObjectRuntimeContext';
import type { PhysicsReplicationProfileId } from '../../physics/runtime/PhysicsReplicationProfiles';
import { ObjectRuntimeContext } from './ObjectRuntimeContext';

export type SharedPhysicsPropSpawnInit = ISharedPropSpawnOptions & {
    replicationProfileId?: PhysicsReplicationProfileId;
};

export function spawnSharedPhysicsProp(
    context: ObjectRuntimeContext,
    moduleId: string,
    init: SharedPhysicsPropSpawnInit
): PhysicsPropEntity | null {
    const entityId = (typeof init.entityId === 'string' && init.entityId.length > 0)
        ? init.entityId
        : context.instanceId;

    let entity: PhysicsPropEntity | null = null;

    if (init.shape === 'sphere') {
        entity = context.createSharedSpherePropEntity(
            entityId,
            init.radius ?? 0.09,
            init.position,
            init.mesh as any,
            moduleId,
            init.ownerId,
            init.grabbable,
            init.physicsTuning,
            init.replicationProfileId ?? init.profile
        );
    } else {
        entity = context.createSharedBoxPropEntity(
            entityId,
            init.size ?? 0.12,
            init.position,
            init.mesh as any,
            init.halfExtents,
            moduleId,
            init.ownerId,
            init.grabbable,
            init.physicsTuning,
            init.url,
            init.scale,
            init.dualGrabScalable,
            init.replicationProfileId ?? init.profile
        );
    }

    if (entity) {
        applyInteractionConfig(entity, init);
    }

    return entity;
}

function applyInteractionConfig(entity: PhysicsPropEntity, init: SharedPhysicsPropSpawnInit): void {
    const interaction = init.interaction;
    if (!interaction) return;

    if (interaction.onUse) {
        entity.onInteraction = (event) => {
            interaction.onUse?.(event, entity as any);
        };
    }

    if (interaction.onGrab) {
        const baseOnGrab = entity.onGrab.bind(entity);
        entity.onGrab = (playerId, hand) => {
            baseOnGrab(playerId, hand);
            interaction.onGrab?.(playerId, hand, entity as any);
        };
    }

    if (interaction.onRelease) {
        const baseOnRelease = entity.onRelease.bind(entity);
        entity.onRelease = (velocity) => {
            baseOnRelease(velocity);
            interaction.onRelease?.(velocity, entity as any);
        };
    }

    if (interaction.getCanonicalGrabOffset) {
        (entity as PhysicsPropEntity & IMovableHoldable).getCanonicalGrabOffset = (hand: 'left' | 'right') =>
            interaction.getCanonicalGrabOffset!(hand, entity as any) ?? {
                position: { x: 0, y: 0, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            };
    }

    if (interaction.getPreferredHeldQuaternionSpace) {
        (entity as PhysicsPropEntity & IMovableHoldable).getPreferredHeldQuaternionSpace = () => {
            const space = interaction.getPreferredHeldQuaternionSpace?.(entity as any);
            return space === 'aim' ? 'aim' : 'grip';
        };
    }
}
