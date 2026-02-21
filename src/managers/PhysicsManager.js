// managers/PhysicsManager.js
import RAPIER from '@dimforge/rapier3d-compat';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class PhysicsManager {
    constructor() {
        this.world = null;
        this.dynamicBodies = []; // Map visual meshes to physics bodies
        this.rapierLoaded = false;
    }

    async init() {
        await RAPIER.init();

        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new RAPIER.World(gravity);
        this.rapierLoaded = true;

        console.log('[PhysicsManager] Rapier3D initialized');
        eventBus.emit(EVENTS.PHYSICS_READY);
    }

    /**
     * Create a static ground collider
     */
    createGround(size = 50) {
        if (!this.world) return;
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(size, 0.1, size);
        this.world.createCollider(groundColliderDesc);
    }

    /**
     * Create a dynamic rigid body box and register it for sync
     */
    createBox(size, position, mesh) {
        if (!this.world) return;

        // Create Rigid Body
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);
        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        // Create Collider
        // Rapier cuboid takes half-extents
        const colliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2);
        this.world.createCollider(colliderDesc, rigidBody);

        // Link for synchronization
        if (mesh) {
            this.dynamicBodies.push({ mesh, rigidBody });
        }

        return rigidBody;
    }

    step(delta) {
        if (!this.rapierLoaded || !this.world) return;

        // We can step the simulation based on delta or a fixed time step.
        // For simplicity, we just call step(), which uses its configured timestep.
        this.world.step();

        // Sync physics transforms to visual meshes
        for (const item of this.dynamicBodies) {
            const position = item.rigidBody.translation();
            const rotation = item.rigidBody.rotation();

            item.mesh.position.set(position.x, position.y, position.z);
            item.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        }
    }
}
