import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEntity } from '../entities/PhysicsEntity';
import { IVector3 } from '../interfaces/IMath';
import { IView } from '../interfaces/IView';
import { PhysicsPropView } from '../views/PhysicsPropView';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { EntityType } from '../interfaces/IEntityState';

export interface IPhysicsDebugBody {
    id: string;
    rigidBody: RAPIER.RigidBody;
    colliders: RAPIER.Collider[];
    ownerId: string | null;
    isAuthority: boolean;
    hasNetworkState: boolean;
    simMode: string | null;
    snapshotBufferSize: number;
    lastTransferSeq: number;
}

interface IPhysicsDebugBodyEntry {
    id: string;
    rigidBody: RAPIER.RigidBody;
    colliders: RAPIER.Collider[];
    getOwnerId?: () => string | null;
    getIsAuthority?: () => boolean;
    getSimMode?: () => string | null;
    getSnapshotBufferSize?: () => number;
    getLastTransferSeq?: () => number;
}

export class PhysicsManager {
    public world: RAPIER.World | null = null;
    private nextPhysicsId: number = 0;
    private accumulator: number = 0;
    private fixedTimeStep: number = 1 / 60;
    private debugBodies: Map<number, IPhysicsDebugBodyEntry> = new Map();
    private eventQueue: RAPIER.EventQueue | null = null;
    private colliderToEntity: Map<number, PhysicsEntity> = new Map();
    private activePropContacts: Map<string, { a: number; b: number }> = new Map();
    private lastTouchClaimAtMsByEntity: Map<string, number> = new Map();
    // Soft multiplayer UX lease: while holding an authoritative prop, touching another prop
    // periodically requests ownership of the touched prop for local low-latency interaction.
    private touchLeaseClaimIntervalMs: number = 250;
    private touchLeaseProximityDistance: number = 0.55;

    constructor(private context: GameContext) { }

    public async init(): Promise<void> {
        await RAPIER.init();
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new RAPIER.World(gravity);
        this.eventQueue = new RAPIER.EventQueue(true);
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
            this.world.step(this.eventQueue || undefined);
            this.drainCollisionEvents();
            this.accumulator -= this.fixedTimeStep;
        }

        this.processTouchOwnershipLeases();
        this.processProximityTouchLeases();
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
                hasNetworkState: !!entry.getOwnerId,
                simMode: entry.getSimMode ? entry.getSimMode() : null,
                snapshotBufferSize: entry.getSnapshotBufferSize ? entry.getSnapshotBufferSize() : 0,
                lastTransferSeq: entry.getLastTransferSeq ? entry.getLastTransferSeq() : 0
            });
        }
        return out;
    }

    public getTouchLeaseClaimIntervalMs(): number {
        return this.touchLeaseClaimIntervalMs;
    }

    public setTouchLeaseClaimIntervalMs(ms: number): void {
        this.touchLeaseClaimIntervalMs = Math.max(50, Math.floor(ms));
    }

    private registerDebugBody(id: string, rigidBody: RAPIER.RigidBody, collider: RAPIER.Collider, entity?: PhysicsEntity): void {
        const handle = rigidBody.handle;
        const existing = this.debugBodies.get(handle);
        if (existing) {
            existing.colliders.push(collider);
            if (entity) {
                this.colliderToEntity.set(collider.handle, entity);
            }
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
            entry.getSimMode = () => entity.getSimMode?.() ?? null;
            entry.getSnapshotBufferSize = () => entity.getSnapshotBufferSize?.() ?? 0;
            entry.getLastTransferSeq = () => entity.getLastOwnershipTransferSeq?.() ?? 0;
            this.colliderToEntity.set(collider.handle, entity);
        }

        this.debugBodies.set(handle, entry);
    }

    private drainCollisionEvents(): void {
        if (!this.eventQueue) return;

        this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
            const a = this.colliderToEntity.get(handle1);
            const b = this.colliderToEntity.get(handle2);
            if (!a || !b) return;

            const key = this.contactKey(handle1, handle2);
            if (started) {
                this.activePropContacts.set(key, { a: handle1, b: handle2 });
            } else {
                this.activePropContacts.delete(key);
            }
        });
    }

    private processTouchOwnershipLeases(): void {
        if (this.context.isHost) return;

        const localId = this.context.localPlayer?.id;
        if (!localId) return;

        const nowMs = this.nowMs();
        for (const [key, pair] of this.activePropContacts.entries()) {
            const entityA = this.colliderToEntity.get(pair.a);
            const entityB = this.colliderToEntity.get(pair.b);
            if (!entityA || !entityB || entityA.isDestroyed || entityB.isDestroyed) {
                this.activePropContacts.delete(key);
                continue;
            }

            if (entityA.heldBy === localId && entityA.isAuthority) {
                this.tryClaimTouchLease(entityB, nowMs, localId);
            }
            if (entityB.heldBy === localId && entityB.isAuthority) {
                this.tryClaimTouchLease(entityA, nowMs, localId);
            }
        }
    }

    private processProximityTouchLeases(): void {
        if (this.context.isHost) return;

        const localId = this.context.localPlayer?.id;
        if (!localId) return;

        const physicsEntities: PhysicsEntity[] = [];
        for (const entity of this.context.managers.entity.entities.values()) {
            if (entity.type === EntityType.PHYSICS_PROP) {
                physicsEntities.push(entity as PhysicsEntity);
            }
        }

        if (physicsEntities.length < 2) return;

        const heldAuthoritative: PhysicsEntity[] = [];
        for (const entity of physicsEntities) {
            if (entity.heldBy === localId && entity.isAuthority) {
                heldAuthoritative.push(entity);
            }
        }

        if (heldAuthoritative.length === 0) return;

        const nowMs = this.nowMs();
        const maxD2 = this.touchLeaseProximityDistance * this.touchLeaseProximityDistance;

        for (const source of heldAuthoritative) {
            const sourcePos = source.rigidBody.translation();
            for (const target of physicsEntities) {
                if (target === source) continue;
                if (target.isDestroyed) continue;
                if (target.ownerId === localId || target.isAuthority) continue;
                if (target.heldBy && target.heldBy !== localId) continue;

                const targetPos = target.rigidBody.translation();
                const dx = sourcePos.x - targetPos.x;
                const dy = sourcePos.y - targetPos.y;
                const dz = sourcePos.z - targetPos.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 <= maxD2) {
                    this.tryClaimTouchLease(target, nowMs, localId);
                }
            }
        }
    }

    private tryClaimTouchLease(target: PhysicsEntity, nowMs: number, localId: string): void {
        if (target.isDestroyed) return;
        if (target.heldBy && target.heldBy !== localId) return;
        if (target.ownerId === localId || target.isAuthority) return;

        const lastClaimAt = this.lastTouchClaimAtMsByEntity.get(target.id) ?? 0;
        if ((nowMs - lastClaimAt) < this.touchLeaseClaimIntervalMs) return;

        this.lastTouchClaimAtMsByEntity.set(target.id, nowMs);
        target.requestOwnership();
    }

    private contactKey(a: number, b: number): string {
        return a < b ? `${a}:${b}` : `${b}:${a}`;
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
