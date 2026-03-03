import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsEntity } from '../../world/entities/PhysicsEntity';
import { IVector3 } from '../../shared/contracts/IMath';
import { IView } from '../../shared/contracts/IView';
import { PhysicsPropView } from '../../render/views/PhysicsPropView';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { EntityType } from '../../shared/contracts/IEntityState';

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
    touchQueryHits: number;
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

export class PhysicsRuntime {
    public world: RAPIER.World | null = null;
    private nextPhysicsId: number = 0;
    private accumulator: number = 0;
    private fixedTimeStep: number = 1 / 60;
    private debugBodies: Map<number, IPhysicsDebugBodyEntry> = new Map();
    private eventQueue: RAPIER.EventQueue | null = null;
    private colliderToEntity: Map<number, PhysicsEntity> = new Map();
    private entityToPrimaryCollider: Map<string, RAPIER.Collider> = new Map();
    private activePropContacts: Map<string, { a: number; b: number }> = new Map();
    private lastTouchClaimAtMsByEntity: Map<string, number> = new Map();
    // Soft multiplayer UX lease: while holding an authoritative prop, touching another prop
    // periodically requests ownership of the touched prop for local low-latency interaction.
    private touchLeaseClaimIntervalMs: number = 250;
    private touchLeaseProximityDistance: number = 0.55;
    private pendingReleaseMinHoldMs: number = 220;
    private pendingReleaseMaxHoldMs: number = 900;
    private touchQueryShape: RAPIER.Ball = new RAPIER.Ball(0.55);
    private grabQueryShape: RAPIER.Ball = new RAPIER.Ball(0.05);
    private readonly identityRotation = { x: 0, y: 0, z: 0, w: 1 };
    private touchQueryHitsThisFrame: number = 0;
    private touchQueryHitsAccum: number = 0;
    private touchQueryFramesAccum: number = 0;
    private touchQueryAvgAccumulatorSec: number = 0;
    private touchQueryAvgHitsPerFrame: number = 0;
    private touchQueryHitsByEntityAccum: Map<string, number> = new Map();
    private touchQueryHitsByEntityWindow: Map<string, number> = new Map();
    private collisionSoundCooldownMs: number = 100;
    private lastCollisionSoundAtByPair: Map<string, number> = new Map();

    constructor(private context: AppContext) { }

    public async init(): Promise<void> {
        await RAPIER.init();
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new RAPIER.World(gravity);
        this.eventQueue = new RAPIER.EventQueue(true);
        console.log('[PhysicsRuntime] Rapier3D initialized');
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

    public createGrabbable(
        id: string,
        size: number,
        position: IVector3,
        mesh: any,
        view?: IView<any>,
        halfExtents?: IVector3
    ): PhysicsEntity | null {
        if (!this.world) return null;

        const entityId = id || `grabbable-${this.nextPhysicsId++}`;

        // If no mesh or view was provided (remote discovery), create a default one
        let finalView = view;
        if (!finalView) {
            const hx = halfExtents?.x ?? (size / 2);
            const hy = halfExtents?.y ?? (size / 2);
            const hz = halfExtents?.z ?? (size / 2);
            const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
            const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
            const defaultMesh = new THREE.Mesh(geo, mat);
            defaultMesh.position.set(position.x, position.y, position.z);
            finalView = new PhysicsPropView(defaultMesh, entityId);

            if (this.context.runtime.render) {
                finalView.addToScene(this.context.runtime.render.scene);
            }
        }

        const hx = halfExtents?.x ?? (size / 2);
        const hy = halfExtents?.y ?? (size / 2);
        const hz = halfExtents?.z ?? (size / 2);
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(0.5)
            .setAngularDamping(0.5)
            .setCanSleep(true)
            .setSleeping(true);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setRestitution(0.2)
            .setFriction(0.7)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, rigidBody);

        const physicsEntity = new PhysicsEntity(this.context, entityId, this.context.isHost, rigidBody, {
            grabbable: true,
            spawnPosition: position,
            view: finalView,
            grabRadius: Math.max(hx, hy, hz)
        });
        physicsEntity.setPendingReleaseHoldWindow(this.pendingReleaseMinHoldMs, this.pendingReleaseMaxHoldMs);
        this.registerDebugBody(entityId, rigidBody, collider, physicsEntity);

        const entityManager = this.context.runtime.entity;
        if (entityManager) {
            entityManager.addEntity(physicsEntity);
        }

        return physicsEntity;
    }

    public step(delta: number): void {
        if (!this.world) return;
        this.touchQueryHitsThisFrame = 0;
        this.accumulator += delta;
        while (this.accumulator >= this.fixedTimeStep) {
            this.world.step(this.eventQueue || undefined);
            this.drainCollisionEvents();
            this.accumulator -= this.fixedTimeStep;
        }

        this.processTouchOwnershipLeases();
        this.processProximityTouchLeases();
        this.updateTouchQueryMetrics(delta);
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
                lastTransferSeq: entry.getLastTransferSeq ? entry.getLastTransferSeq() : 0,
                touchQueryHits: this.touchQueryHitsByEntityWindow.get(entry.id) ?? 0
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

    public getTouchLeaseProximityDistance(): number {
        return this.touchLeaseProximityDistance;
    }

    public setTouchLeaseProximityDistance(distance: number): void {
        this.touchLeaseProximityDistance = Math.max(0.1, Math.min(2.0, distance));
        this.touchQueryShape = new RAPIER.Ball(this.touchLeaseProximityDistance);
    }

    public getPendingReleaseMinHoldMs(): number {
        return this.pendingReleaseMinHoldMs;
    }

    public getPendingReleaseMaxHoldMs(): number {
        return this.pendingReleaseMaxHoldMs;
    }

    public setPendingReleaseHoldWindow(minMs: number, maxMs: number): void {
        const clampedMin = Math.max(0, Math.floor(minMs));
        const clampedMax = Math.max(clampedMin + 50, Math.floor(maxMs));
        this.pendingReleaseMinHoldMs = clampedMin;
        this.pendingReleaseMaxHoldMs = clampedMax;

        const entities = new Set<PhysicsEntity>();
        for (const entity of this.colliderToEntity.values()) {
            entities.add(entity);
        }
        for (const entity of entities) {
            entity.setPendingReleaseHoldWindow(clampedMin, clampedMax);
        }
    }

    public getTouchQueryAverageHitsPerFrame(): number {
        return this.touchQueryAvgHitsPerFrame;
    }

    public queryNearestPhysicsGrabbable(point: IVector3, gripRadius: number): { entity: PhysicsEntity; distance: number } | null {
        if (!this.world) return null;
        this.grabQueryShape.radius = Math.max(0.01, gripRadius);

        let nearestEntity: PhysicsEntity | null = null;
        let minDistance = Number.POSITIVE_INFINITY;

        this.world.intersectionsWithShape(
            { x: point.x, y: point.y, z: point.z },
            this.identityRotation,
            this.grabQueryShape,
            (collider) => {
                const entity = this.colliderToEntity.get(collider.handle);
                if (!entity || entity.isDestroyed || !entity.isGrabbable || !!entity.heldBy) return true;

                const projection = collider.projectPoint({ x: point.x, y: point.y, z: point.z }, true);
                if (!projection) return true;

                const dx = projection.point.x - point.x;
                const dy = projection.point.y - point.y;
                const dz = projection.point.z - point.z;
                const dist = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));

                if (dist < minDistance) {
                    minDistance = dist;
                    nearestEntity = entity;
                }
                return true;
            }
        );

        if (!nearestEntity || minDistance > gripRadius) return null;
        return { entity: nearestEntity, distance: minDistance };
    }

    public createStaticCuboidCollider(hx: number, hy: number, hz: number, position: IVector3): RAPIER.Collider | null {
        if (!this.world) return null;
        const body = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
        );
        const collider = this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(hx, hy, hz).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
            body
        );
        this.registerDebugBody(`static-cuboid-${this.nextPhysicsId++}`, body, collider);
        return collider;
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
            if (!this.entityToPrimaryCollider.has(entity.id)) {
                this.entityToPrimaryCollider.set(entity.id, collider);
            }
        }

        this.debugBodies.set(handle, entry);
    }

    private drainCollisionEvents(): void {
        if (!this.eventQueue) return;

        this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
            const a = this.colliderToEntity.get(handle1);
            const b = this.colliderToEntity.get(handle2);
            if (a && b) {
                const key = this.contactKey(handle1, handle2);
                if (started) {
                    this.activePropContacts.set(key, { a: handle1, b: handle2 });
                } else {
                    this.activePropContacts.delete(key);
                }
            }

            if (!started) return;

            eventBus.emit(EVENTS.PHYSICS_COLLISION_STARTED, {
                handleA: handle1,
                handleB: handle2,
                entityAId: a?.id || null,
                entityBId: b?.id || null
            });

            const hasPhysicsPropEntity =
                a?.type === EntityType.PHYSICS_PROP ||
                b?.type === EntityType.PHYSICS_PROP;
            if (!hasPhysicsPropEntity || !this.world) return;

            const nowMs = this.nowMs();
            const pairKey = this.contactKey(handle1, handle2);
            const lastAt = this.lastCollisionSoundAtByPair.get(pairKey) ?? 0;
            if ((nowMs - lastAt) < this.collisionSoundCooldownMs) return;
            this.lastCollisionSoundAtByPair.set(pairKey, nowMs);

            const colliderA = this.world.getCollider(handle1);
            const colliderB = this.world.getCollider(handle2);
            if (!colliderA && !colliderB) return;

            const bodyA = colliderA?.parent();
            const bodyB = colliderB?.parent();
            const velA = bodyA?.linvel();
            const velB = bodyB?.linvel();
            const speedA = velA ? Math.hypot(velA.x, velA.y, velA.z) : 0;
            const speedB = velB ? Math.hypot(velB.x, velB.y, velB.z) : 0;
            const relSpeed = Math.abs(speedA - speedB);
            const impactSpeed = Math.max(relSpeed, speedA, speedB);

            // Keep collision SFX subtle: low floor, capped ceiling.
            const intensity = Math.min(0.35, Math.max(0.05, impactSpeed * 0.09));
            if (intensity <= 0.05) return;

            eventBus.emit(EVENTS.ENTITY_COLLIDED, { intensity });
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
        if (this.context.isHost || !this.world) return;

        const localId = this.context.localPlayer?.id;
        if (!localId) return;

        const heldAuthoritative: PhysicsEntity[] = [];
        const dedupe = new Set<string>();
        for (const entity of this.context.runtime.entity.entities.values()) {
            if (entity.type !== EntityType.PHYSICS_PROP) continue;
            const prop = entity as PhysicsEntity;
            if (prop.heldBy === localId && prop.isAuthority && !dedupe.has(prop.id)) {
                dedupe.add(prop.id);
                heldAuthoritative.push(prop);
            }
        }

        if (heldAuthoritative.length === 0) return;

        const nowMs = this.nowMs();
        for (const source of heldAuthoritative) {
            const sourcePos = source.rigidBody.translation();
            const sourceCollider = this.entityToPrimaryCollider.get(source.id);
            this.world.intersectionsWithShape(
                { x: sourcePos.x, y: sourcePos.y, z: sourcePos.z },
                this.identityRotation,
                this.touchQueryShape,
                (collider) => {
                    const target = this.colliderToEntity.get(collider.handle);
                    if (!target || target === source) return true;
                    this.touchQueryHitsThisFrame++;
                    this.touchQueryHitsByEntityAccum.set(target.id, (this.touchQueryHitsByEntityAccum.get(target.id) ?? 0) + 1);
                    this.tryClaimTouchLease(target, nowMs, localId);
                    return true;
                },
                undefined,
                undefined,
                sourceCollider
            );
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

    private updateTouchQueryMetrics(delta: number): void {
        this.touchQueryHitsAccum += this.touchQueryHitsThisFrame;
        this.touchQueryFramesAccum += 1;
        this.touchQueryAvgAccumulatorSec += delta;

        if (this.touchQueryAvgAccumulatorSec < 1.0) return;

        this.touchQueryAvgHitsPerFrame = this.touchQueryFramesAccum > 0
            ? this.touchQueryHitsAccum / this.touchQueryFramesAccum
            : 0;

        this.touchQueryHitsByEntityWindow = new Map(this.touchQueryHitsByEntityAccum);

        this.touchQueryHitsAccum = 0;
        this.touchQueryFramesAccum = 0;
        this.touchQueryAvgAccumulatorSec = 0;
        this.touchQueryHitsByEntityAccum.clear();
    }

}
