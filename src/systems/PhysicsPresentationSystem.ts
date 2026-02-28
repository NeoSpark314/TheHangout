import { GameContext } from '../core/GameState';
import { IUpdatable } from '../interfaces/IUpdatable';
import { EntityType } from '../interfaces/IEntityState';
import { PhysicsEntity } from '../entities/PhysicsEntity';

/**
 * Runs after physics and applies visual state for physics props.
 * This keeps rendering concerns out of simulation update logic.
 */
export class PhysicsPresentationSystem implements IUpdatable {
    constructor(private context: GameContext) { }

    public update(delta: number, _frame?: XRFrame): void {
        const entityManager = this.context.managers.entity;
        if (!entityManager) return;

        for (const entity of entityManager.entities.values()) {
            if (entity.type !== EntityType.PHYSICS_PROP) continue;
            (entity as PhysicsEntity).present(delta);
        }
    }
}

