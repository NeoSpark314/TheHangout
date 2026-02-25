import * as THREE from 'three';
import { LocalPlayer } from '../entities/LocalPlayer';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SpectatorEntity } from '../entities/SpectatorEntity';
import { StickFigureView } from '../views/StickFigureView';
import { SpectatorView } from '../views/SpectatorView';
import { PhysicsPropView } from '../views/PhysicsPropView';
import { PhysicsEntity } from '../entities/PhysicsEntity';
import { PenEntity } from '../entities/PenEntity';
import { PenView } from '../views/PenView';
import { GameContext } from '../core/GameState';
import { Vector3 } from '../interfaces/IMath';

export class EntityFactory {
    private static registry: Map<string, (context: GameContext, id: string, config: any) => any> = new Map();

    static {
        // Register default types
        this.register('LOCAL_PLAYER', (context, id, config) => this.createPlayer(context, id, { ...config, isLocal: true }));
        this.register('REMOTE_PLAYER', (context, id, config) => this.createPlayer(context, id, { ...config, isLocal: false }));
        this.register('SPECTATOR', (context, id, config) => this.createSpectator(context, id, config.isAuthority));
        this.register('PHYSICS_PROP', (context, id, config) => {
            // For remote discovery, we might not have the mesh yet
            // If config.mesh is missing, createGrabbable handles it or we use a default
            return this.createGrabbable(context, id, config.size || 0.12, config.position || { x: 0, y: 0, z: 0 }, config.mesh);
        });
        this.register('PEN', (context, id, config) => this.createPen(context, id, config));
    }

    public static register(type: string, creator: (context: GameContext, id: string, config: any) => any): void {
        this.registry.set(type, creator);
    }

    public static spawn(context: GameContext, type: string, id: string, config: any): any {
        const creator = this.registry.get(type);
        if (!creator) {
            console.warn(`[EntityFactory] No creator registered for type: ${type}`);
            return null;
        }
        return creator(context, id, config);
    }

    public static createPlayer(context: GameContext, id: string, { isLocal, spawnPos, spawnYaw, color }: { isLocal: boolean, spawnPos: Vector3, spawnYaw: number, color?: string | number }): LocalPlayer | RemotePlayer {
        const view = new StickFigureView(context, {
            color: color || (isLocal ? context.avatarConfig.color : 0xff00ff),
            isLocal: isLocal
        });

        const entity = isLocal
            ? new LocalPlayer(context, id, spawnPos, spawnYaw, view)
            : new RemotePlayer(context, id, view);

        const render = context.managers.render;
        if (render) {
            view.addToScene(render.scene);
            view.addToInteractionGroup(render.interactionGroup);
        }

        return entity;
    }

    public static createSpectator(context: GameContext, id: string, isAuthority: boolean): SpectatorEntity {
        const view = new SpectatorView();
        const entity = new SpectatorEntity(context, id, isAuthority, view);

        const render = context.managers.render;
        if (render) {
            view.addToScene(render.scene);
            view.addToInteractionGroup(render.interactionGroup);
        }

        return entity;
    }

    public static createGrabbable(context: GameContext, id: string, size: number, position: Vector3, mesh: THREE.Mesh): PhysicsEntity | null {
        const view = new PhysicsPropView(mesh, id);
        const managers = context.managers;

        if (!managers.physics) {
            console.error('[EntityFactory] Physics manager not found');
            return null;
        }

        if (managers.render) {
            view.addToScene(managers.render.scene);
            view.addToInteractionGroup(managers.render.interactionGroup);
        }

        return managers.physics.createGrabbable(id, size, position, mesh, view);
    }

    public static createPen(context: GameContext, id: string, config: any): PenEntity {
        const view = new PenView(id);
        const entity = new PenEntity(context, id, !!config.isAuthority, view);

        if (config.position) {
            entity.updateGrabbedPose(config.position, config.quaternion || { x: 0, y: 0, z: 0, w: 1 });
        }

        const render = context.managers.render;
        if (render) {
            view.addToScene(render.scene);
            view.addToInteractionGroup(render.interactionGroup);
        }

        return entity;
    }
}
