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
        // Visual floor is at y = -0.05.
        // We create a fixed body for the ground to ensure best stability.
        const halfHeight = 0.5;
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(0, -0.05 - halfHeight, 0);
        const groundBody = this.world.createRigidBody(groundBodyDesc);

        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(size, halfHeight, size);
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
            .setRestitution(0.0);  // Don't bounce/vibrate indefinitely
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
     * Create a rigid body hexagon (cylinder-like) and register it for sync.
     * Accurate prismatic hull matching Three.js CylinderGeometry.
     */
    createHexagon(radius, height, position, mesh, isStatic = false) {
        if (!this.world) return;

        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
            : RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        // Generate 12 vertices (6 top, 6 bottom)
        const hh = height / 2;
        const vertices = new Float32Array(12 * 3);
        for (let i = 0; i < 6; i++) {
            // Three.js CylinderGeometry orientation: x=sin, z=cos (Z-up-ish internally)
            const theta = (i / 6) * Math.PI * 2;
            const x = Math.sin(theta) * radius;
            const z = Math.cos(theta) * radius;

            // Top
            vertices[i * 3] = x;
            vertices[i * 3 + 1] = hh;
            vertices[i * 3 + 2] = z;

            // Bottom
            vertices[(i + 6) * 3] = x;
            vertices[(i + 6) * 3 + 1] = -hh;
            vertices[(i + 6) * 3 + 2] = z;
        }

        const colliderDesc = RAPIER.ColliderDesc.convexHull(vertices)
            .setFriction(1.0)
            .setRestitution(0.0);
        this.world.createCollider(colliderDesc, rigidBody);

        if (!isStatic) {
            const entityId = `physics-hexagon-${this.nextPhysicsId++}`;
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

    /**
     * Create a grabbable dynamic rigid body and register it
     */
    createGrabbable(size, position, mesh) {
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
            .setFriction(0.7);    // Restored natural friction
        this.world.createCollider(colliderDesc, rigidBody);

        const entityId = `grabbable-${this.nextPhysicsId++}`;
        const physicsEntity = new PhysicsEntity(entityId, gameState.isHost, mesh, rigidBody, {
            grabbable: true,
            spawnPosition: position
        });

        if (gameState.managers.entity) {
            gameState.managers.entity.addEntity(physicsEntity);
        }

        return physicsEntity;
    }

    step(delta) {
        if (!this.world) return;

        // Use a fixed timestep for physics simulation to prevent tunneling.
        // Even if the frame rate drops (or menus lag), we step at a consistent 60Hz.
        const fixedTimeStep = 1 / 60;
        this.world.timestep = fixedTimeStep;

        // In a real game, you might want to loop here to catch up on 'accumulatedTime'
        // But for this simulation, a single 1/60th step per frame is usually enough and stable.
        this.world.step();
    }
}
