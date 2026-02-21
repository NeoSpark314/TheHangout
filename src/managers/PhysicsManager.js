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
     * Create a rigid body cuboid and register it for sync
     */
    createCuboid(hx, hy, hz, position, mesh, isStatic = false) {
        if (!this.world) return;

        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
            : RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        // Rapier cuboid takes half-extents
        const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
        this.world.createCollider(colliderDesc, rigidBody);

        if (!isStatic) {
            const entityId = `physics-cuboid-${this.nextPhysicsId++}`;
            const physicsEntity = new PhysicsEntity(entityId, gameState.isHost, mesh, rigidBody);

            if (gameState.managers.entity) {
                gameState.managers.entity.addEntity(physicsEntity);
            }
        }

        return rigidBody;
    }

    /**
     * Create a rigid body box (uniform) and register it for sync
     */
    createBox(size, position, mesh, isStatic = false) {
        return this.createCuboid(size / 2, size / 2, size / 2, position, mesh, isStatic);
    }

    step(delta) {
        if (!this.rapierLoaded || !this.world) return;

        // Step the actual physics simulation.
        // Syncing mesh transforms from rigid bodies is now handled individually 
        // by each PhysicsEntity during the EntityManager.update() pass.
        this.world.step();
    }
}
