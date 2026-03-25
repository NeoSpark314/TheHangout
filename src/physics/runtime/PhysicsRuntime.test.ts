import { describe, expect, it } from 'vitest';
import { AppContext } from '../../app/AppContext';
import { PhysicsRuntime } from './PhysicsRuntime';

describe('PhysicsRuntime heightfield teardown', () => {
    it('clears terrain sampling metadata when a static heightfield is removed', async () => {
        const app = new AppContext();
        const physics = new PhysicsRuntime(app);
        (physics as any).world = {
            getRigidBody: (id: number) => (id === 123 ? { handle: 123 } : null),
            removeRigidBody: () => { }
        };
        (physics as any).terrainMetadata = {
            nrows: 4,
            ncols: 4,
            heights: new Float32Array(16).fill(1),
            scale: { x: 4, y: 1, z: 4 },
            bodyHandle: 123
        };

        expect((physics as any).terrainMetadata).toBeTruthy();

        physics.removeRigidBody({ id: 123 } as any);

        expect((physics as any).terrainMetadata).toBeNull();
        expect(physics.getTerrainHeight(0, 0)).toBe(0);
    });
});
