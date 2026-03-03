import { GameContext } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { EntityType } from '../../shared/contracts/IEntityState';
import { PhysicsEntity } from '../../world/entities/PhysicsEntity';

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

