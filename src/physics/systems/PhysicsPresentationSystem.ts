import { AppContext } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { EntityType } from '../../shared/contracts/IEntityState';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';

/**
 * Runs after physics and applies visual state for physics props.
 * This keeps rendering concerns out of simulation update logic.
 */
export class PhysicsPresentationSystem implements IUpdatable {
    constructor(private context: AppContext) { }

    public update(delta: number, _frame?: XRFrame): void {
        const entityRegistry = this.context.runtime.entity;
        if (!entityRegistry) return;

        for (const entity of entityRegistry.entities.values()) {
            if (entity.type !== EntityType.PHYSICS_PROP) continue;
            (entity as PhysicsPropEntity).present(delta);
        }
    }
}
