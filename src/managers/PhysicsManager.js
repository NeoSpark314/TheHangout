// managers/PhysicsManager.js
import RAPIER from '@dimforge/rapier3d-compat';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class PhysicsManager {
    constructor() {
        this.world = null;
        this.dynamicBodies = []; // Map visual meshes to physics bodies
        this.rapierLoaded = false;

        eventBus.on(EVENTS.NETWORK_DATA_RECEIVED, (e) => this.onNetworkData(e));
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

    onNetworkData({ senderId, type, data }) {
        if (type === 'STATE' && !gameState.isHost) {
            // We are a guest receiving authoritative physics state from the host
            // `data` is an array of body states
            data.forEach(state => {
                const bodyObj = this.dynamicBodies[state.id];
                if (bodyObj && bodyObj.mesh) {
                    // Snap the visual mesh
                    bodyObj.mesh.position.set(state.p[0], state.p[1], state.p[2]);
                    bodyObj.mesh.quaternion.set(state.r[0], state.r[1], state.r[2], state.r[3]);

                    // Also update the local rigid body so guest physical interactions remain somewhat accurate locally
                    if (bodyObj.rigidBody) {
                        bodyObj.rigidBody.setTranslation({ x: state.p[0], y: state.p[1], z: state.p[2] }, true);
                        bodyObj.rigidBody.setRotation({ x: state.r[0], y: state.r[1], z: state.r[2], w: state.r[3] }, true);
                    }
                }
            });
        }
    }
}
