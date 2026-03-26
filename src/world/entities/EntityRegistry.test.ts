import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../app/AppContext';
import { EntityType } from '../../shared/contracts/IEntityState';
import { EntityRegistry } from './EntityRegistry';

describe('EntityRegistry', () => {
    it('preserves per-instance module-backed prop color during discovery', () => {
        const app = new AppContext();
        const spawnObjectInstance = vi.fn().mockReturnValue({
            getPrimaryEntity: () => null
        });

        app.setRuntime('session', {
            getObjectModuleDefinition: vi.fn().mockReturnValue({ id: 'grabbable-cube', networked: true }),
            getObjectInstance: vi.fn().mockReturnValue(null),
            spawnObjectInstance
        } as any);

        const registry = new EntityRegistry(app);
        registry.discover('default-cube-0', EntityType.PHYSICS_PROP, {
            m: 'grabbable-cube',
            c: 0xff0055,
            p: [1, 2, 3],
            he: [0.06, 0.06, 0.06],
            ownerId: null
        });

        expect(spawnObjectInstance).toHaveBeenCalledWith('grabbable-cube', expect.objectContaining({
            id: 'default-cube-0',
            entityId: 'default-cube-0',
            color: 0xff0055,
            position: { x: 1, y: 2, z: 3 },
            halfExtents: { x: 0.06, y: 0.06, z: 0.06 }
        }));
    });
});
