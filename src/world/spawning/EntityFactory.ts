import * as THREE from 'three';
import { PlayerAvatarEntity } from '../entities/PlayerAvatarEntity';
import { AvatarView } from '../../render/avatar/AvatarView';
import { PhysicsPropView } from '../../render/views/PhysicsPropView';
import { PhysicsPropEntity } from '../entities/PhysicsPropEntity';
import { PenToolEntity } from '../entities/PenToolEntity';
import { PenView } from '../../render/views/PenView';
import { AppContext } from '../../app/AppContext';
import { IVector3 } from '../../shared/contracts/IMath';
import { NullView } from '../../render/views/NullView';
import { EntityType } from '../../shared/contracts/IEntityState';
import { IEntity } from '../../shared/contracts/IEntity';
import { LocalPlayerControlStrategy } from '../entities/strategies/LocalPlayerControlStrategy';
import { RemotePlayerReplicationStrategy } from '../entities/strategies/RemotePlayerReplicationStrategy';
import type { PhysicsReplicationProfileId } from '../../physics/runtime/PhysicsReplicationProfiles';
import type { IAvatarConfig } from '../../shared/contracts/IAvatar';

export class EntityFactory {
    private static registry: Map<string, (context: AppContext, id: string, config: Record<string, any>) => IEntity | null> = new Map();

    static {
        // Register default types
        this.register('PLAYER_AVATAR', (context, id, config) => this.createPlayer(context, id, {
            ...config,
            isLocal: config.controlMode ? config.controlMode === 'local' : !!config.isLocal,
            avatarConfig: config.conf
        }));
        this.register('PHYSICS_PROP', (context, id, config) => {
            // For remote discovery, we might not have the mesh yet
            // If config.mesh is missing, createGrabbable handles it or we use a default
            return this.createGrabbable(
                context,
                id,
                config.size || 0.12,
                config.position || { x: 0, y: 0, z: 0 },
                config.mesh,
                config.halfExtents,
                config.moduleId,
                config.ownerId,
                config.url,
                config.scale,
                config.dualGrabScalable,
                config.replicationProfileId
            );
        });
        this.register('PEN', (context, id, config) => this.createPen(context, id, config));
    }

    public static register(type: string, creator: (context: AppContext, id: string, config: Record<string, any>) => IEntity | null): void {
        this.registry.set(type, creator);
    }

    public static spawn(context: AppContext, type: string, id: string, config: Record<string, any>): IEntity | null {
        const creator = this.registry.get(type);
        if (!creator) {
            console.warn(`[EntityFactory] No creator registered for type: ${type}`);
            return null;
        }
        return creator(context, id, config);
    }

    public static createPlayer(
        context: AppContext,
        id: string,
        {
            isLocal,
            spawnPos = { x: 0, y: 0, z: 0 },
            spawnYaw = 0,
            color,
            avatarConfig
        }: {
            isLocal: boolean,
            spawnPos?: IVector3,
            spawnYaw?: number,
            color?: string | number,
            avatarConfig?: Partial<IAvatarConfig>
        }
    ): PlayerAvatarEntity {
        const render = context.runtime.render;
        const view = render
            ? new AvatarView(context, {
                color: color || (isLocal ? context.avatarConfig.color : 0xff00ff),
                isLocal,
                avatarConfig: avatarConfig || (isLocal ? context.avatarConfig : undefined)
            })
            : new NullView(id);

        const entity = new PlayerAvatarEntity(
            context,
            id,
            EntityType.PLAYER_AVATAR,
            isLocal,
            view,
            {
                controlMode: isLocal ? 'local' : 'remote',
                spawnPos,
                spawnYaw,
                avatarConfig
            }
        );
        entity.attachControlStrategy(
            isLocal
                ? new LocalPlayerControlStrategy()
                : new RemotePlayerReplicationStrategy()
        );

        if (render) {
            view.addToScene(render.scene);
            view.addToInteractionGroup(render.interactionGroup);
        }

        return entity;
    }

    public static createGrabbable(
        context: AppContext,
        id: string,
        size: number,
        position: IVector3,
        mesh: THREE.Mesh,
        halfExtents?: IVector3,
        moduleId?: string,
        ownerId?: string | null,
        url?: string,
        scale?: number,
        dualGrabScalable?: boolean,
        replicationProfileId?: PhysicsReplicationProfileId
    ): PhysicsPropEntity | null {
        const runtime = context.runtime;
        const render = runtime.render;

        // Ensure PhysicsPropView isn't created if there's no mesh or render context
        const view = render && mesh ? new PhysicsPropView(mesh, id) : new NullView(id);

        if (!runtime.physics) {
            console.error('[EntityFactory] Physics runtime not found');
            return null;
        }

        if (render && view instanceof PhysicsPropView) {
            view.addToScene(render.scene);
            view.addToInteractionGroup(render.interactionGroup);
        }

        return runtime.physics.createGrabbable(
            id,
            size,
            position,
            mesh,
            view,
            halfExtents,
            moduleId,
            ownerId,
            url,
            scale,
            dualGrabScalable,
            replicationProfileId
        );
    }

    public static createSphereGrabbable(
        context: AppContext,
        id: string,
        radius: number,
        position: IVector3,
        mesh: THREE.Mesh,
        moduleId?: string,
        ownerId?: string | null,
        replicationProfileId?: PhysicsReplicationProfileId
    ): PhysicsPropEntity | null {
        const runtime = context.runtime;
        const render = runtime.render;
        const view = render && mesh ? new PhysicsPropView(mesh, id) : new NullView(id);

        if (!runtime.physics) {
            console.error('[EntityFactory] Physics runtime not found');
            return null;
        }

        if (render && view instanceof PhysicsPropView) {
            view.addToScene(render.scene);
            view.addToInteractionGroup(render.interactionGroup);
        }

        return runtime.physics.createSphereGrabbable(
            id,
            radius,
            position,
            mesh,
            view,
            moduleId,
            ownerId,
            replicationProfileId
        );
    }

    public static createPen(context: AppContext, id: string, config: Record<string, any>): PenToolEntity | null {
        const runtime = context.runtime;
        const render = runtime.render;
        const view = render ? new PenView(id) : new NullView(id);

        if (!runtime.physics) {
            console.error('[EntityFactory] Physics runtime not found');
            return null;
        }

        const position = config.position || { x: 0, y: 1.15, z: 0 };
        const extents = { x: 0.05, y: 0.05, z: 0.05 };

        const physicsData = runtime.physics.createSensorBody(position, extents);
        if (!physicsData) return null;

        const entity = new PenToolEntity(context, id, !!config.isAuthority, physicsData.rigidBody, view, config);

        if (config.position) {
            entity.updateGrabbedPose({
                position: config.position,
                quaternion: config.quaternion || { x: 0, y: 0, z: 0, w: 1 }
            });
        }

        runtime.physics.registerPhysicsEntity(entity, physicsData.rigidBody, physicsData.collider);

        if (render && view instanceof PenView) {
            view.addToScene(render.scene);
            view.addToInteractionGroup(render.interactionGroup);
        }

        return entity;
    }
}

