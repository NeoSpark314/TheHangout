import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEntity } from '../entities/PhysicsEntity';
import { Vector3 } from '../interfaces/IMath';
import { IView } from '../interfaces/IView';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

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

    public createGrabbable(id: string, size: number, position: Vector3, mesh: any, view: IView<any>): PhysicsEntity | null {
        if (!this.world) return null;

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

        const entityId = id || `grabbable-${this.nextPhysicsId++}`;
        const physicsEntity = new PhysicsEntity(entityId, (gameState as any).isHost, rigidBody, {
            grabbable: true,
            spawnPosition: position,
            view: view
        });

        const entityManager = (gameState as any).managers.entity;
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
