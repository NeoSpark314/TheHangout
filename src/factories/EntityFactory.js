// factories/EntityFactory.js

import { LocalPlayer } from '../entities/LocalPlayer.js';
import { RemotePlayer } from '../entities/RemotePlayer.js';
import { SpectatorEntity } from '../entities/SpectatorEntity.js';
import { PhysicsEntity } from '../entities/PhysicsEntity.js';
import { StickFigureView } from '../views/StickFigureView.js';
import { SpectatorView } from '../views/SpectatorView.js';
import { PhysicsPropView } from '../views/PhysicsPropView.js';
import gameState from '../core/GameState.js';

/**
 * Centralized factory for creating all game entities.
 * Decouples the "what" (entity type) from the "how" (class + view wiring).
 */
export class EntityFactory {
    /**
     * Create a player entity (Local or Remote).
     * @param {string} id
     * @param {Object} options
     * @param {boolean} options.isLocal
     * @param {THREE.Vector3} [options.spawnPos]
     * @param {number} [options.spawnYaw]
     * @param {number|string} [options.color]
     */
    static createPlayer(id, { isLocal, spawnPos, spawnYaw, color }) {
        const view = new StickFigureView({
            color: color || (isLocal ? gameState.avatarConfig.color : 0xff00ff),
            isLocal: isLocal
        });

        const entity = isLocal
            ? new LocalPlayer(id, spawnPos, spawnYaw, view)
            : new RemotePlayer(id, view);

        const { render } = gameState.managers;
        if (render) {
            view.addToScene(render.scene);
        }

        return entity;
    }

    /**
     * Create a spectator entity.
     * @param {string} id
     * @param {boolean} isAuthority
     */
    static createSpectator(id, isAuthority) {
        const view = new SpectatorView();
        const entity = new SpectatorEntity(id, isAuthority, view);

        const { render } = gameState.managers;
        if (render) {
            view.addToScene(render.scene);
        }

        return entity;
    }

    /**
     * Create a grabbable physics entity.
     * @param {string} id
     * @param {number} size
     * @param {Object} position
     * @param {THREE.Mesh} mesh
     */
    static createGrabbable(id, size, position, mesh) {
        const view = new PhysicsPropView(mesh);
        const { render, physics } = gameState.managers;

        if (!physics) {
            console.error('[EntityFactory] Physics manager not found');
            return null;
        }

        if (render) {
            view.addToScene(render.scene);
        }

        const entity = physics.createGrabbable(id, size, position, mesh, view);

        return entity;
    }
}
