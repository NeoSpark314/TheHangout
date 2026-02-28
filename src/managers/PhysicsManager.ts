import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEntity } from '../entities/PhysicsEntity';
import { IVector3 } from '../interfaces/IMath';
import { IView } from '../interfaces/IView';
import { PhysicsPropView } from '../views/PhysicsPropView';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

export interface IPhysicsDebugBody {
    id: string;
    rigidBody: RAPIER.RigidBody;
    colliders: RAPIER.Collider[];
    ownerId: string | null;
    isAuthority: boolean;
    hasNetworkState: boolean;
}

interface IPhysicsDebugBodyEntry {
    id: string;
    rigidBody: RAPIER.RigidBody;
    colliders: RAPIER.Collider[];
    getOwnerId?: () => string | null;
    getIsAuthority?: () => boolean;
}

export class PhysicsManager {
    public world: RAPIER.World | null = null;
    private nextPhysicsId: number = 0;
    private accumulator: number = 0;
    private fixedTimeStep: number = 1 / 60;
    private debugBodies: Map<number, IPhysicsDebugBodyEntry> = new Map();

    constructor(private context: GameContext) { }

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
        const groundCollider = this.world.createCollider(groundColliderDesc, groundBody);
        this.registerDebugBody('ground', groundBody, groundCollider);
    }

    public createCuboid(hx: number, hy: number, hz: number, position: IVector3, mesh: any, isStatic: boolean = false): RAPIER.RigidBody | undefined {
        if (!this.world) return;
        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
            : RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);
        const rigidBody = this.world.createRigidBody(rigidBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setFriction(1.0)
            .setRestitution(0.0)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, rigidBody);
        this.registerDebugBody(`cuboid-${this.nextPhysicsId++}`, rigidBody, collider);
        return rigidBody;
    }

    public createHexagon(radius: number, height: number, position: IVector3, mesh: any, isStatic: boolean = false): RAPIER.RigidBody | undefined {
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
        const collider = this.world.createCollider(colliderDesc, rigidBody);
        this.registerDebugBody(`hexagon-${this.nextPhysicsId++}`, rigidBody, collider);
        return rigidBody;
    }

    public createGrabbable(id: string, size: number, position: IVector3, mesh: any, view?: IView<any>): PhysicsEntity | null {
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

            if (this.context.managers.render) {
                finalView.addToScene(this.context.managers.render.scene);
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
        const collider = this.world.createCollider(colliderDesc, rigidBody);

        const physicsEntity = new PhysicsEntity(this.context, entityId, this.context.isHost, rigidBody, {
            grabbable: true,
            spawnPosition: position,
            view: finalView
        });
        this.registerDebugBody(entityId, rigidBody, collider, physicsEntity);

        const entityManager = this.context.managers.entity;
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

    public getDebugBodies(): IPhysicsDebugBody[] {
        const out: IPhysicsDebugBody[] = [];
        for (const entry of this.debugBodies.values()) {
            out.push({
                id: entry.id,
                rigidBody: entry.rigidBody,
                colliders: entry.colliders,
                ownerId: entry.getOwnerId ? entry.getOwnerId() : null,
                isAuthority: entry.getIsAuthority ? entry.getIsAuthority() : false,
                hasNetworkState: !!entry.getOwnerId
            });
        }
        return out;
    }

    private registerDebugBody(id: string, rigidBody: RAPIER.RigidBody, collider: RAPIER.Collider, entity?: PhysicsEntity): void {
        const handle = rigidBody.handle;
        const existing = this.debugBodies.get(handle);
        if (existing) {
            existing.colliders.push(collider);
            return;
        }

        const entry: IPhysicsDebugBodyEntry = {
            id,
            rigidBody,
            colliders: [collider]
        };

        if (entity) {
            entry.getOwnerId = () => entity.ownerId;
            entry.getIsAuthority = () => entity.isAuthority;
        }

        this.debugBodies.set(handle, entry);
    }
}
