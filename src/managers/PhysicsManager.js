import * as THREE from 'three';
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

        // Timestep Accumulator
        this.accumulator = 0;
        this.fixedTimeStep = 1 / 60;
    }

    async init() {
        await RAPIER.init();

        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new RAPIER.World(gravity);
        this.eventQueue = new RAPIER.EventQueue(true);
        this.rapierLoaded = true;

        // Track last sound time per collider to prevent spam
        this.lastCollisionTime = new Map();
        this.collisionCooldown = 150; // ms

        console.log('[PhysicsManager] Rapier3D initialized');
        eventBus.emit(EVENTS.PHYSICS_READY);
    }

    /**
     * Create a static ground collider
     */
    createGround(size = 50) {
        if (!this.world) return;
        // Visual floor is at y = -0.05.
        // We create a fixed body for the ground to ensure best stability.
        const halfHeight = 0.5;
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(0, -0.05 - halfHeight, 0);
        const groundBody = this.world.createRigidBody(groundBodyDesc);

        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(size, halfHeight, size);
        groundColliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.world.createCollider(groundColliderDesc, groundBody);
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
        const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setFriction(1.0)      // Stick to surfaces
            .setRestitution(0.0)  // Don't bounce/vibrate indefinitely
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
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
     * Create a hexagonal collision shape using a Cylinder primitive.
     * Cylinders are much more stable for resting objects than convex hulls.
     */
    createHexagon(radius, height, position, mesh, isStatic = false) {
        if (!this.world) return;

        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed()
            : RAPIER.RigidBodyDesc.dynamic();
        rigidBodyDesc.setTranslation(position.x, position.y, position.z);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        // We use a Cylinder primitive. 
        // Note: Rapier's cylinder is Y-aligned by default.
        const hh = height / 2;
        const colliderDesc = RAPIER.ColliderDesc.cylinder(hh, radius)
            .setFriction(1.0)
            .setRestitution(0.0)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.world.createCollider(colliderDesc, rigidBody);

        if (!isStatic) {
            const entityId = `physics-hexagon-${this.nextPhysicsId++}`;
            const physicsEntity = new PhysicsEntity(entityId, gameState.isHost, mesh, rigidBody, {
                spawnPosition: position
            });

            if (gameState.managers.entity) {
                gameState.managers.entity.addEntity(physicsEntity);
            }
            return physicsEntity;
        }

        return rigidBody;
    }

    /**
     * Create a rigid body box (uniform) and register it for sync
     */
    createBox(size, position, mesh, isStatic = false) {
        return this.createCuboid(size / 2, size / 2, size / 2, position, mesh, isStatic);
    }

    /**
     * Create a grabbable dynamic rigid body and register it
     * @param {string} id - Explicit ID, or null to auto-generate
     * @param {number} size - Cube side length
     * @param {Object} position - {x, y, z}
     * @param {THREE.Mesh} mesh
     * @param {import('../views/EntityView.js').EntityView} [view] - Optional visual
     */
    createGrabbable(id, size, position, mesh, view) {
        if (!this.world) return null;

        const hs = size / 2; // half-extent
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(0.5)
            .setAngularDamping(0.5)
            .setCanSleep(true)
            .setSleeping(true);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.cuboid(hs, hs, hs)
            .setRestitution(0.2)  // Restored slight bounce
            .setFriction(0.7)    // Restored natural friction
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.world.createCollider(colliderDesc, rigidBody);

        const entityId = id || `grabbable-${this.nextPhysicsId++}`;
        const physicsEntity = new PhysicsEntity(entityId, gameState.isHost, mesh, rigidBody, {
            grabbable: true,
            spawnPosition: position,
            view: view || null
        });

        if (gameState.managers.entity) {
            gameState.managers.entity.addEntity(physicsEntity);
        }

        return physicsEntity;
    }

    step(delta) {
        if (!this.world) return;

        // Add elapsed time to accumulator
        this.accumulator += delta;

        // Step the world in fixed increments
        // This ensures gravity and settling are consistent regardless of frame rate
        this.world.timestep = this.fixedTimeStep;

        let stepsRun = 0;
        const maxStepsPerFrame = 5; // Prevent "Spiral of Death" if lag is extreme

        while (this.accumulator >= this.fixedTimeStep && stepsRun < maxStepsPerFrame) {
            this.world.step();
            this.accumulator -= this.fixedTimeStep;
            stepsRun++;
        }

        // Catch up or clear if we're falling too far behind
        if (this.accumulator > this.fixedTimeStep) {
            this.accumulator = 0;
        }
    }
}
