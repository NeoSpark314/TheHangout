import * as THREE from 'three';
import { LocalPlayer } from '../entities/LocalPlayer';
import { RemotePlayer } from '../entities/RemotePlayer';
import { StickFigureView } from '../views/StickFigureView';
import { PhysicsPropView } from '../views/PhysicsPropView';
import { PhysicsEntity } from '../entities/PhysicsEntity';
import gameState from '../core/GameState.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from '../interfaces/IMath';

export class EntityFactory {
    public static createPlayer(id: string, { isLocal, spawnPos, spawnYaw, color }: { isLocal: boolean, spawnPos: Vector3, spawnYaw: number, color?: string | number }): LocalPlayer | RemotePlayer {
        const view = new StickFigureView({
            color: color || (isLocal ? (gameState as any).avatarConfig.color : 0xff00ff),
            isLocal: isLocal
        });

        const entity = isLocal
            ? new LocalPlayer(id, spawnPos, spawnYaw, view)
            : new RemotePlayer(id, view);

        const render = (gameState as any).managers.render;
        if (render) {
            view.addToScene(render.scene);
        }

        return entity;
    }

    public static createGrabbable(id: string, size: number, position: Vector3, mesh: THREE.Mesh): PhysicsEntity | null {
        const view = new PhysicsPropView(mesh);
        const managers = (gameState as any).managers;
        
        if (!managers.physics) {
            console.error('[EntityFactory] Physics manager not found');
            return null;
        }

        if (managers.render) {
            view.addToScene(managers.render.scene);
        }

        // Delegate to physics manager
        return managers.physics.createGrabbable(id, size, position, mesh, view);
    }
}
