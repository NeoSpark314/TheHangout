import * as THREE from 'three';
import { LocalPlayer } from '../entities/LocalPlayer';
import { RemotePlayer } from '../entities/RemotePlayer';
import { SpectatorEntity } from '../entities/SpectatorEntity';
import { StickFigureView } from '../views/StickFigureView';
import { SpectatorView } from '../views/SpectatorView';
import { PhysicsPropView } from '../views/PhysicsPropView';
import { PhysicsEntity } from '../entities/PhysicsEntity';
import gameState from '../core/GameState';
import { Vector3 } from '../interfaces/IMath';

export class EntityFactory {
    private static registry: Map<string, (id: string, config: any) => any> = new Map();

    static {
        // Register default types
        this.register('LOCAL_PLAYER', (id, config) => this.createPlayer(id, { ...config, isLocal: true }));
        this.register('REMOTE_PLAYER', (id, config) => this.createPlayer(id, { ...config, isLocal: false }));
        this.register('SPECTATOR', (id, config) => this.createSpectator(id, config.isAuthority));
        this.register('PHYSICS_PROP', (id, config) => this.createGrabbable(id, config.size, config.position, config.mesh));
    }

    public static register(type: string, creator: (id: string, config: any) => any): void {
        this.registry.set(type, creator);
    }

    public static spawn(type: string, id: string, config: any): any {
        const creator = this.registry.get(type);
        if (!creator) {
            console.warn(`[EntityFactory] No creator registered for type: ${type}`);
            return null;
        }
        return creator(id, config);
    }

    public static createPlayer(id: string, { isLocal, spawnPos, spawnYaw, color }: { isLocal: boolean, spawnPos: Vector3, spawnYaw: number, color?: string | number }): LocalPlayer | RemotePlayer {
        const view = new StickFigureView({
            color: color || (isLocal ? gameState.avatarConfig.color : 0xff00ff),
            isLocal: isLocal
        });

        const entity = isLocal
            ? new LocalPlayer(id, spawnPos, spawnYaw, view)
            : new RemotePlayer(id, view);

        const render = gameState.managers.render;
        if (render) {
            view.addToScene(render.scene);
        }

        return entity;
    }

    public static createSpectator(id: string, isAuthority: boolean): SpectatorEntity {
        const view = new SpectatorView();
        const entity = new SpectatorEntity(id, isAuthority, view);

        const render = gameState.managers.render;
        if (render) {
            view.addToScene(render.scene);
        }

        return entity;
    }

    public static createGrabbable(id: string, size: number, position: Vector3, mesh: THREE.Mesh): PhysicsEntity | null {
        const view = new PhysicsPropView(mesh, id);
        const managers = gameState.managers;
        
        if (!managers.physics) {
            console.error('[EntityFactory] Physics manager not found');
            return null;
        }

        if (managers.render) {
            view.addToScene(managers.render.scene);
        }

        return managers.physics.createGrabbable(id, size, position, mesh, view);
    }
}
