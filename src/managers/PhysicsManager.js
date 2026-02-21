import RAPIER from '@dimforge/rapier3d-compat';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';
import { PhysicsEntity } from '../entities/PhysicsEntity.js';
import gameState from '../core/GameState.js';

export class PhysicsManager {
    constructor() {
        this.world = null;
        this.rapierLoaded = false;

        // Counter for generating sequential IDs for physics entities
        this.nextPhysicsId = 0;
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
     * Create a rigid body box and register it for sync
     */
    createBox(size, position, mesh, isStatic = false) {
        if (!this.world) return;

        // Create Rigid Body
        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
            : RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        // Create Collider
        // Rapier cuboid takes half-extents
        const colliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2);
        this.world.createCollider(colliderDesc, rigidBody);

        // Only create a networked entity for dynamic objects that need syncing.
        // Static objects don't move, so they don't need a PhysicsEntity to sync transforms.
        if (!isStatic) {
            const entityId = `physics-box-${this.nextPhysicsId++}`;
            const physicsEntity = new PhysicsEntity(entityId, gameState.isHost, mesh, rigidBody);

            if (gameState.managers.entity) {
                gameState.managers.entity.addEntity(physicsEntity);
            }
        }

        return rigidBody;
    }

    step(delta) {
        if (!this.rapierLoaded || !this.world) return;

        // Step the actual physics simulation.
        // Syncing mesh transforms from rigid bodies is now handled individually 
        // by each PhysicsEntity during the EntityManager.update() pass.
        this.world.step();
    }
}
