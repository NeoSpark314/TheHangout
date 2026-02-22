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
        // We create a 1m thick ground collider.
        // Top surface should be at -0.05, so center is at -0.05 - 0.5 = -0.55.
        const halfHeight = 0.5;
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(size, halfHeight, size)
            .setTranslation(0, -0.05 - halfHeight, 0);
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
     * Create a hexagonal collision shape by overlapping three cuboids.
     * This is generally more stable than a convex hull for flat surfaces.
     */
    createHexagon(radius, height, position, mesh, isStatic = false) {
        if (!this.world) return;

        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
            : RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        // A hexagon can be approximated by 3 overlapping cuboids rotated by 60 degrees.
        // For a radius R (center to vertex), the width of the cuboid (face to face) is R * sqrt(3).
        // Wait, CylinderGeometry radius is center-to-vertex.
        // So width of one rectangle is Radius * 2, and the other dimension is Radius * sqrt(3).
        const hh = height / 2;
        const hx = radius;               // length (vertex to vertex)
        const hz = radius * 0.866;       // width (face to face / 2) -> R * sin(60)

        // Create 3 colliders at the same position but rotated
        const baseDesc = RAPIER.ColliderDesc.cuboid(hx, hh, hz);

        // 0 degrees
        this.world.createCollider(baseDesc, rigidBody);

        // 60 degrees (rotate around Y)
        const q60 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
        const desc60 = RAPIER.ColliderDesc.cuboid(hx, hh, hz)
            .setRotation({ x: q60.x, y: q60.y, z: q60.z, w: q60.w });
        this.world.createCollider(desc60, rigidBody);

        // 120 degrees
        const q120 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2 * Math.PI / 3);
        const desc120 = RAPIER.ColliderDesc.cuboid(hx, hh, hz)
            .setRotation({ x: q120.x, y: q120.y, z: q120.z, w: q120.w });
        this.world.createCollider(desc120, rigidBody);

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
            .setAngularDamping(0.5);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.cuboid(hs, hs, hs)
            .setRestitution(0.4)  // Slight bounce
            .setFriction(0.8);
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
        if (!this.rapierLoaded || !this.world) return;

        // Step the actual physics simulation.
        // Syncing mesh transforms from rigid bodies is now handled individually 
        // by each PhysicsEntity during the EntityManager.update() pass.
        this.world.step();
    }
}
