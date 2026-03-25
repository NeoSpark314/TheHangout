import type { AppContext } from '../app/AppContext';
import type { IDrawSegmentPayload } from '../shared/contracts/IDrawing';
import type { ISpawnedObjectInstance } from '../content/contracts/ISpawnedObjectInstance';
import type { IDrawingSurfaceInstance } from '../content/objects/DrawingSurfaceObject';

function isDrawingSurfaceInstance(instance: ISpawnedObjectInstance | undefined): instance is IDrawingSurfaceInstance {
    if (!instance) return false;
    return typeof (instance as IDrawingSurfaceInstance).addSegment === 'function'
        && typeof (instance as IDrawingSurfaceInstance).clear === 'function';
}

/**
 * Thin facade for the active shared drawing object.
 *
 * Drawing state now lives in a scenario-owned spawned object instance
 * (`drawing-surface`) so it can be enabled/disabled by scenario and synced
 * through the generic object-instance replication path.
 */
export class DrawingSkill {
    constructor(private context: AppContext) { }

    public addSegment(segment: IDrawSegmentPayload): void {
        this.getActiveDrawingSurface()?.addSegment(segment, true);
    }

    public clear(): void {
        this.getActiveDrawingSurface()?.clear();
    }

    private getActiveDrawingSurface(): IDrawingSurfaceInstance | null {
        const instance = this.context.runtime.session.getFirstObjectInstanceByModuleId('drawing-surface');
        return isDrawingSurfaceInstance(instance) ? instance : null;
    }
}
