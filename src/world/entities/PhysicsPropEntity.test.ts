import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AppContext } from '../../app/AppContext';
import { EntityRegistry } from './EntityRegistry';
import { PhysicsRuntime } from '../../physics/runtime/PhysicsRuntime';

describe('PhysicsPropEntity teardown', () => {
    it('removes the rigid body from the physics world when the entity is destroyed', async () => {
        const app = new AppContext();
        const physics = new PhysicsRuntime(app);

        app.setRuntime('entity', new EntityRegistry(app));
        app.setRuntime('physicsAuthority', {
            syncEntityAuthority: () => { },
            forgetEntity: () => { },
            getTouchLeaseProximityDistance: () => 0.55
        } as any);
        app.setRuntime('render', {
            scene: new THREE.Scene()
        } as any);
        app.setRuntime('physics', physics);

        await physics.init();

        const entity = physics.createGrabbable(
            'teardown-cube',
            0.2,
            { x: 0, y: 1, z: 0 },
            new THREE.Group()
        );

        expect(entity).toBeTruthy();
        const rigidBodyHandle = entity!.rigidBody.handle;
        expect(physics.world?.getRigidBody(rigidBodyHandle)).toBeTruthy();

        app.runtime.entity.removeEntity(entity!.id);
        physics.flushPendingRemovals();

        expect(entity!.isDestroyed).toBe(true);
        expect(physics.world?.getRigidBody(rigidBodyHandle)).toBeNull();
    });
});
