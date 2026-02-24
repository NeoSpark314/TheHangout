import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEntity } from '../entities/PhysicsEntity';
import { Vector3 } from '../interfaces/IMath';
import { IView } from '../interfaces/IView';
import { PhysicsPropView } from '../views/PhysicsPropView';
import gameState from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

export class PhysicsManager {
    public world: RAPIER.World | null = null;
    private nextPhysicsId: number = 0;
    private accumulator: number = 0;
    private fixedTimeStep: number = 1 / 60;

    public async init(): Promise<void> {
        await RAPIER.init();
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new RAPIER.World(gravity);
        console.log('[PhysicsManager] Rapier3D initialized');
        eventBus.emit(EVENTS.PHYSICS_READY);
    }

    public createGround(size: number = 50): void {
        if (!this.world) return;
        const halfHeight = 0.5;
        const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(0, -0.05 - halfHeight, 0);
        const groundBody = this.world.createRigidBody(groundBodyDesc);
        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(size, halfHeight, size);
        groundColliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.world.createCollider(groundColliderDesc, groundBody);
    }

    public createCuboid(hx: number, hy: number, hz: number, position: Vector3, mesh: any, isStatic: boolean = false): RAPIER.RigidBody | undefined {
        if (!this.world) return;
        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
            : RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);
        const rigidBody = this.world.createRigidBody(rigidBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setFriction(1.0)
            .setRestitution(0.0)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.world.createCollider(colliderDesc, rigidBody);
        return rigidBody;
    }

    public createHexagon(radius: number, height: number, position: Vector3, mesh: any, isStatic: boolean = false): RAPIER.RigidBody | undefined {
        if (!this.world) return;
        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed()
            : RAPIER.RigidBodyDesc.dynamic();
        rigidBodyDesc.setTranslation(position.x, position.y, position.z);
        const rigidBody = this.world.createRigidBody(rigidBodyDesc);
        const hh = height / 2;
        const colliderDesc = RAPIER.ColliderDesc.cylinder(hh, radius)
            .setFriction(1.0)
            .setRestitution(0.0)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.world.createCollider(colliderDesc, rigidBody);
        return rigidBody;
    }

    public createGrabbable(id: string, size: number, position: Vector3, mesh: any, view?: IView<any>): PhysicsEntity | null {
        if (!this.world) return null;

        const entityId = id || `grabbable-${this.nextPhysicsId++}`;

        // If no mesh or view was provided (remote discovery), create a default one
        let finalView = view;
        if (!finalView) {
            const geo = new THREE.BoxGeometry(size, size, size);
            const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
            const defaultMesh = new THREE.Mesh(geo, mat);
            defaultMesh.position.set(position.x, position.y, position.z);
            finalView = new PhysicsPropView(defaultMesh, entityId);
            
            if (gameState.managers.render) {
                finalView.addToScene(gameState.managers.render.scene);
            }
        }

        const hs = size / 2;
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(0.5)
            .setAngularDamping(0.5)
            .setCanSleep(true)
            .setSleeping(true);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(hs, hs, hs)
            .setRestitution(0.2)
            .setFriction(0.7)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        this.world.createCollider(colliderDesc, rigidBody);

        const physicsEntity = new PhysicsEntity(entityId, gameState.isHost, rigidBody, {
            grabbable: true,
            spawnPosition: position,
            view: finalView
        });

        const entityManager = gameState.managers.entity;
        if (entityManager) {
            entityManager.addEntity(physicsEntity);
        }

        return physicsEntity;
    }

    public step(delta: number): void {
        if (!this.world) return;
        this.accumulator += delta;
        while (this.accumulator >= this.fixedTimeStep) {
            this.world.step();
            this.accumulator -= this.fixedTimeStep;
        }
    }
}
