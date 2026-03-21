import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import { IVector3 } from '../../shared/contracts/IMath';
import { IView } from '../../shared/contracts/IView';
import { PhysicsPropView } from '../../render/views/PhysicsPropView';
import { AppContext } from '../../app/AppContext';
import { NullView } from '../../render/views/NullView';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { EntityType } from '../../shared/contracts/IEntityState';
import { IHoldable } from '../../shared/contracts/IHoldable';
import { IInteractable } from '../../shared/contracts/IInteractable';
import type {
    IPhysicsBodyHandle,
    IPhysicsColliderHandle
} from '../../content/contracts/IObjectRuntimeContext';
import { resolvePhysicsReplicationProfile, type PhysicsReplicationProfileId } from './PhysicsReplicationProfiles';

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

export interface IPhysicsRayHit {
    point: IVector3;
    normal: IVector3;
    distance: number;
    entityId: string | null;
    colliderId: number;
}

interface IInteractionImpulseOptions {
    linearFactor?: number;
    torqueFactor?: number;
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

type PhysicsInteractionTarget = IHoldable & IInteractable;
type RuntimePhysicsBodyHandle = IPhysicsBodyHandle & { readonly rigidBody: RAPIER.RigidBody };
type RuntimePhysicsColliderHandle = IPhysicsColliderHandle & { readonly collider: RAPIER.Collider };

export class PhysicsRuntime {
    public world: RAPIER.World | null = null;
    private nextPhysicsId: number = 0;
    private accumulator: number = 0;
    private fixedTimeStep: number = 1 / 60;
    private debugBodies: Map<number, IPhysicsDebugBodyEntry> = new Map();
    private eventQueue: RAPIER.EventQueue | null = null;
    private colliderToEntity: Map<number, PhysicsPropEntity> = new Map();
    private interactionColliders: Map<number, PhysicsInteractionTarget> = new Map();
    private entityToPrimaryCollider: Map<string, RAPIER.Collider> = new Map();
    private activePropContacts: Map<string, { a: number; b: number }> = new Map();
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
    private pendingImpulseByEntity: Map<string, { impulse: IVector3; point: IVector3; expiresAtMs: number; options?: IInteractionImpulseOptions }> = new Map();
    private pendingImpulseLifetimeMs: number = 400;

    constructor(private context: AppContext) { }

    public async init(): Promise<void> {
        await RAPIER.init();
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new RAPIER.World(gravity);
        this.eventQueue = new RAPIER.EventQueue(true);
        this.touchQueryShape = new RAPIER.Ball(this.context.runtime.physicsAuthority.getTouchLeaseProximityDistance());
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

    public createCuboid(
        hx: number,
        hy: number,
        hz: number,
        position: IVector3,
        mesh: any,
        isStatic: boolean = false,
        rotation?: { x: number; y: number; z: number; w: number }
    ): RAPIER.RigidBody | undefined {
        if (!this.world) return;
        const rigidBodyDesc = isStatic
            ? RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
            : RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);
        if (rotation) {
            rigidBodyDesc.setRotation(rotation);
        }
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

        // Build a true 6-sided prism collider so physical shape matches the visual hex table top.
        const vertices: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const x = Math.sin(angle) * radius;
            const z = Math.cos(angle) * radius;
            vertices.push(x, hh, z);
            vertices.push(x, -hh, z);
        }

        let colliderDesc = RAPIER.ColliderDesc.convexHull(new Float32Array(vertices));
        if (!colliderDesc) {
            // Fallback for runtimes that fail convex hull creation.
            colliderDesc = RAPIER.ColliderDesc.cylinder(hh, radius);
        }

        colliderDesc
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
        halfExtents?: IVector3,
        moduleId?: string,
        ownerId?: string | null,
        url?: string,
        scale?: number,
        dualGrabScalable?: boolean,
        replicationProfileId?: PhysicsReplicationProfileId
    ): PhysicsPropEntity | null {
        if (!this.world) return null;

        const entityId = id || `grabbable-${this.nextPhysicsId++}`;
        const replicationProfile = resolvePhysicsReplicationProfile(replicationProfileId, 'box');

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
            .setLinearDamping(replicationProfile.body.linearDamping)
            .setAngularDamping(replicationProfile.body.angularDamping)
            .setCanSleep(true)
            .setSleeping(true);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setRestitution(replicationProfile.material.restitution)
            .setFriction(replicationProfile.material.friction)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, rigidBody);

        const physicsEntity = new PhysicsPropEntity(this.context, entityId, this.context.isHost, rigidBody, {
            grabbable: true,
            spawnPosition: position,
            view: finalView,
            grabRadius: Math.max(hx, hy, hz),
            halfExtents,
            moduleId,
            ownerId,
            url,
            initialScale: scale,
            dualGrabScalable,
            replicationProfileId,
            shape: 'box'
        });
        this.registerDebugBody(entityId, rigidBody, collider, physicsEntity);

        const entityRegistry = this.context.runtime.entity;
        if (!entityRegistry) return null;
        entityRegistry.addEntity(physicsEntity);
        if (typeof scale === 'number' && Number.isFinite(scale) && physicsEntity.supportsDualGrabScale()) {
            physicsEntity.setUniformScale(scale);
        }

        return physicsEntity;
    }

    public createSphereGrabbable(
        id: string,
        radius: number,
        position: IVector3,
        mesh: any,
        view?: IView<any>,
        moduleId?: string,
        ownerId?: string | null,
        replicationProfileId?: PhysicsReplicationProfileId
    ): PhysicsPropEntity | null {
        if (!this.world) return null;

        const entityId = id || `sphere-grabbable-${this.nextPhysicsId++}`;
        const finalView = view ?? new NullView(entityId);
        const replicationProfile = resolvePhysicsReplicationProfile(replicationProfileId, 'sphere');

        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(replicationProfile.body.linearDamping)
            .setAngularDamping(replicationProfile.body.angularDamping)
            .setCanSleep(true)
            .setSleeping(true);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.ball(radius)
            .setRestitution(replicationProfile.material.restitution)
            .setFriction(replicationProfile.material.friction)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(colliderDesc, rigidBody);

        const physicsEntity = new PhysicsPropEntity(this.context, entityId, this.context.isHost, rigidBody, {
            grabbable: true,
            spawnPosition: position,
            view: finalView,
            grabRadius: radius,
            halfExtents: { x: radius, y: radius, z: radius },
            moduleId,
            ownerId,
            replicationProfileId,
            shape: 'sphere'
        });
        this.registerDebugBody(entityId, rigidBody, collider, physicsEntity);

        const entityRegistry = this.context.runtime.entity;
        if (!entityRegistry) return null;
        entityRegistry.addEntity(physicsEntity);
        return physicsEntity;
    }

    public updateGrabbableCollider(
        entityId: string,
        mesh: any,
        size: number,
        halfExtents?: IVector3
    ): void {
        const entityRegistry = this.context.runtime.entity;
        if (!entityRegistry || !this.world) return;

        const entity = entityRegistry.getEntity(entityId) as PhysicsPropEntity;
        if (!entity || !entity.rigidBody) return;

        const rigidBody = entity.rigidBody;
        const debugEntry = this.debugBodies.get(rigidBody.handle);
        if (!debugEntry) return;

        // Remove old colliders
        for (const collider of debugEntry.colliders) {
            this.colliderToEntity.delete(collider.handle);
            this.interactionColliders.delete(collider.handle);
            this.world.removeCollider(collider, true);
        }
        debugEntry.colliders = [];
        this.entityToPrimaryCollider.delete(entityId);

        // Create new collider
        const hx = halfExtents?.x ?? (size / 2);
        const hy = halfExtents?.y ?? (size / 2);
        const hz = halfExtents?.z ?? (size / 2);

        const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setRestitution(0.2)
            .setFriction(0.7)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

        const collider = this.world.createCollider(colliderDesc, rigidBody);

        debugEntry.colliders.push(collider);
        this.colliderToEntity.set(collider.handle, entity);
        if (entity.isHoldable) {
            this.interactionColliders.set(collider.handle, entity);
        }
        this.entityToPrimaryCollider.set(entityId, collider);

        // Update grab radius
        const newGrabRadius = Math.max(hx, hy, hz);
        (entity as any).grabRadius = Math.max(0.03, newGrabRadius);
    }

    public createSensorBody(
        position: IVector3,
        halfExtents: IVector3
    ): { rigidBody: RAPIER.RigidBody; collider: RAPIER.Collider } | null {
        if (!this.world) return null;

        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinearDamping(0.5)
            .setAngularDamping(0.5)
            .setGravityScale(0) // Floating for tools
            .setCanSleep(true)
            .setSleeping(true);

        const rigidBody = this.world.createRigidBody(rigidBodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
            .setSensor(true) // No collision response
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

        const collider = this.world.createCollider(colliderDesc, rigidBody);

        return { rigidBody, collider };
    }

    public registerPhysicsEntity(entity: PhysicsPropEntity, rigidBody: RAPIER.RigidBody, collider: RAPIER.Collider): void {
        this.registerDebugBody(entity.id, rigidBody, collider, entity);
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
        this.processPendingImpulses();
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
        return this.context.runtime.physicsAuthority.getTouchLeaseClaimIntervalMs();
    }

    public setTouchLeaseClaimIntervalMs(ms: number): void {
        this.context.runtime.physicsAuthority.setTouchLeaseClaimIntervalMs(ms);
    }

    public getTouchLeaseProximityDistance(): number {
        return this.context.runtime.physicsAuthority.getTouchLeaseProximityDistance();
    }

    public setTouchLeaseProximityDistance(distance: number): void {
        this.context.runtime.physicsAuthority.setTouchLeaseProximityDistance(distance);
        this.touchQueryShape = new RAPIER.Ball(this.context.runtime.physicsAuthority.getTouchLeaseProximityDistance());
    }

    public getPendingReleaseMinHoldMs(): number {
        return this.context.runtime.physicsAuthority.getPendingReleaseMinHoldMs();
    }

    public getPendingReleaseMaxHoldMs(): number {
        return this.context.runtime.physicsAuthority.getPendingReleaseMaxHoldMs();
    }

    public setPendingReleaseHoldWindow(minMs: number, maxMs: number): void {
        this.context.runtime.physicsAuthority.setPendingReleaseHoldWindow(minMs, maxMs);
        const entities = new Set<PhysicsPropEntity>();
        for (const entity of this.colliderToEntity.values()) {
            entities.add(entity);
        }
        for (const entity of entities) {
            entity.setPendingReleaseHoldWindow(minMs, maxMs);
        }
    }

    public getTouchQueryAverageHitsPerFrame(): number {
        return this.touchQueryAvgHitsPerFrame;
    }


    public applyInteractionImpulse(
        entityId: string,
        impulse: IVector3,
        point: IVector3,
        options?: IInteractionImpulseOptions
    ): boolean {
        const entity = this.context.runtime.entity.getEntity(entityId) as PhysicsPropEntity | undefined;
        if (!entity || entity.type !== EntityType.PHYSICS_PROP || !entity.rigidBody) return false;
        if (entity.heldBy) return false;

        // The host already simulates unowned props authoritatively; transient hits
        // should not stamp durable host ownership onto them.
        if (this.context.isHost && entity.isAuthority && entity.ownerId === null) {
            return this.applyInteractionImpulseNow(entity, impulse, point, options);
        }

        if (!entity.requestImmediatePhysicsAuthority({ allowSpeculativeHostClaim: true })) {
            this.pendingImpulseByEntity.set(entityId, {
                impulse: { x: impulse.x, y: impulse.y, z: impulse.z },
                point: { x: point.x, y: point.y, z: point.z },
                expiresAtMs: this.nowMs() + this.pendingImpulseLifetimeMs,
                options
            });
            return false;
        }

        return this.applyInteractionImpulseNow(entity, impulse, point, options);
    }

    public applyImpulseAtPoint(entityId: string, impulse: IVector3, point: IVector3): boolean {
        return this.applyInteractionImpulse(entityId, impulse, point);
    }
    public raycast(origin: IVector3, direction: IVector3, maxDist: number): IPhysicsRayHit | null {
        if (!this.world) return null;

        const length = Math.hypot(direction.x, direction.y, direction.z);
        if (length < 0.000001) return null;

        const dir = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
        const ray = new RAPIER.Ray(origin, dir);
        const hit = this.world.castRayAndGetNormal(ray, maxDist, true);
        if (!hit) return null;

        const point = ray.pointAt(hit.timeOfImpact);
        const entity = this.colliderToEntity.get(hit.collider.handle) ?? null;
        return {
            point: { x: point.x, y: point.y, z: point.z },
            normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
            distance: hit.timeOfImpact,
            entityId: entity?.id ?? null,
            colliderId: hit.collider.handle
        };
    }
    public queryNearestInteractionCollider(
        point: IVector3,
        gripRadius: number
    ): { target: PhysicsInteractionTarget; distance: number; point: IVector3 } | null {
        if (!this.world) return null;
        const localId = this.context.localPlayer?.id || 'local';
        this.grabQueryShape.radius = Math.max(0.01, gripRadius);

        let nearestTarget: PhysicsInteractionTarget | null = null;
        let minDistance = Number.POSITIVE_INFINITY;
        let nearestPoint: IVector3 | null = null;

        this.world.intersectionsWithShape(
            { x: point.x, y: point.y, z: point.z },
            this.identityRotation,
            this.grabQueryShape,
            (collider) => {
                const target = this.interactionColliders.get(collider.handle);
                if (!target) return true;
                if (target.heldBy && target.heldBy !== localId) return true;

                const projection = collider.projectPoint({ x: point.x, y: point.y, z: point.z }, true);
                if (!projection) return true;

                const dx = projection.point.x - point.x;
                const dy = projection.point.y - point.y;
                const dz = projection.point.z - point.z;
                const dist = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));

                if (dist < minDistance) {
                    minDistance = dist;
                    nearestTarget = target;
                    nearestPoint = {
                        x: projection.point.x,
                        y: projection.point.y,
                        z: projection.point.z
                    };
                }
                return true;
            }
        );

        if (!nearestTarget || !nearestPoint || minDistance > gripRadius) return null;
        return { target: nearestTarget, distance: minDistance, point: nearestPoint };
    }

    public createStaticCuboidCollider(
        hx: number,
        hy: number,
        hz: number,
        position: IVector3,
        rotation?: { x: number; y: number; z: number; w: number }
    ): IPhysicsColliderHandle | null {
        if (!this.world) return null;
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
        if (rotation) {
            bodyDesc.setRotation(rotation);
        }
        const body = this.world.createRigidBody(bodyDesc);
        const collider = this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(hx, hy, hz).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
            body
        );
        this.registerDebugBody(`static-cuboid-${this.nextPhysicsId++}`, body, collider);
        return this.createColliderHandle(collider);
    }

    public createStaticCuboidSensor(
        hx: number,
        hy: number,
        hz: number,
        position: IVector3,
        rotation?: { x: number; y: number; z: number; w: number }
    ): IPhysicsColliderHandle | null {
        if (!this.world) return null;
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
        if (rotation) {
            bodyDesc.setRotation(rotation);
        }
        const body = this.world.createRigidBody(bodyDesc);
        const collider = this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(hx, hy, hz)
                .setSensor(true)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
            body
        );
        this.registerDebugBody(`static-sensor-${this.nextPhysicsId++}`, body, collider);
        return this.createColliderHandle(collider);
    }

    public registerInteractionCollider(collider: IPhysicsColliderHandle | null | undefined, target: PhysicsInteractionTarget): void {
        if (!collider) return;
        this.interactionColliders.set(collider.id, target);
    }

    public unregisterInteractionCollider(collider: IPhysicsColliderHandle | null | undefined): void {
        if (!collider) return;
        this.interactionColliders.delete(collider.id);
    }

    public removeRigidBody(rigidBodyHandle: IPhysicsBodyHandle | RAPIER.RigidBody | null | undefined): void {
        const rigidBody = this.resolveRigidBody(rigidBodyHandle);
        if (!this.world || !rigidBody) return;

        const entry = this.debugBodies.get(rigidBody.handle);
        if (entry) {
            for (const collider of entry.colliders) {
                this.colliderToEntity.delete(collider.handle);
                this.interactionColliders.delete(collider.handle);
            }

            for (const [entityId, collider] of this.entityToPrimaryCollider.entries()) {
                if (entry.colliders.includes(collider)) {
                    this.entityToPrimaryCollider.delete(entityId);
                }
            }

            for (const [key, pair] of this.activePropContacts.entries()) {
                if (entry.colliders.some((collider) => collider.handle === pair.a || collider.handle === pair.b)) {
                    this.activePropContacts.delete(key);
                }
            }

            this.debugBodies.delete(rigidBody.handle);
        }

        this.world.removeRigidBody(rigidBody);
    }

    private resolveRigidBody(
        handle: IPhysicsBodyHandle | RAPIER.RigidBody | null | undefined
    ): RAPIER.RigidBody | null {
        if (!handle || !this.world) {
            return null;
        }

        const asRuntimeHandle = handle as RuntimePhysicsBodyHandle;
        if (asRuntimeHandle.rigidBody && typeof asRuntimeHandle.rigidBody.handle === 'number') {
            return asRuntimeHandle.rigidBody;
        }

        const asRigidBody = handle as RAPIER.RigidBody;
        if (typeof asRigidBody.handle === 'number' && typeof (asRigidBody as any).translation === 'function') {
            return asRigidBody;
        }

        const asIdHandle = handle as IPhysicsBodyHandle;
        if (typeof asIdHandle.id === 'number') {
            return this.world.getRigidBody(asIdHandle.id) || null;
        }

        return null;
    }

    private registerDebugBody(id: string, rigidBody: RAPIER.RigidBody, collider: RAPIER.Collider, entity?: PhysicsPropEntity): void {
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
            if (entity.isHoldable) {
                this.interactionColliders.set(collider.handle, entity);
            }
            if (!this.entityToPrimaryCollider.has(entity.id)) {
                this.entityToPrimaryCollider.set(entity.id, collider);
            }
        }

        this.debugBodies.set(handle, entry);
    }

    private createBodyHandle(rigidBody: RAPIER.RigidBody | null | undefined): IPhysicsBodyHandle | null {
        if (!rigidBody) return null;
        return {
            id: rigidBody.handle,
            rigidBody
        } as RuntimePhysicsBodyHandle;
    }

    private createColliderHandle(collider: RAPIER.Collider | null | undefined): IPhysicsColliderHandle | null {
        if (!collider) return null;
        return {
            id: collider.handle,
            body: this.createBodyHandle(collider.parent()),
            collider
        } as RuntimePhysicsColliderHandle;
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

            const posA = bodyA?.translation() || colliderA?.translation();
            const posB = bodyB?.translation() || colliderB?.translation();
            const position = posA && posB
                ? {
                    x: (posA.x + posB.x) * 0.5,
                    y: (posA.y + posB.y) * 0.5,
                    z: (posA.z + posB.z) * 0.5
                }
                : (posA || posB)
                    ? {
                        x: (posA || posB)!.x,
                        y: (posA || posB)!.y,
                        z: (posA || posB)!.z
                    }
                    : undefined;

            eventBus.emit(EVENTS.ENTITY_COLLIDED, { intensity, position });
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
                this.context.runtime.physicsAuthority.tryClaimTouchLease(entityB, nowMs, localId);
            }
            if (entityB.heldBy === localId && entityB.isAuthority) {
                this.context.runtime.physicsAuthority.tryClaimTouchLease(entityA, nowMs, localId);
            }
        }
    }

    private processProximityTouchLeases(): void {
        if (this.context.isHost || !this.world) return;

        const localId = this.context.localPlayer?.id;
        if (!localId) return;

        const heldAuthoritative: PhysicsPropEntity[] = [];
        const dedupe = new Set<string>();
        for (const entity of this.context.runtime.entity.entities.values()) {
            if (entity.type !== EntityType.PHYSICS_PROP) continue;
            const prop = entity as PhysicsPropEntity;
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
                    this.context.runtime.physicsAuthority.tryClaimTouchLease(target, nowMs, localId);
                    return true;
                },
                undefined,
                undefined,
                sourceCollider
            );
        }
    }

    private contactKey(a: number, b: number): string {
        return a < b ? `${a}:${b}` : `${b}:${a}`;
    }

    private processPendingImpulses(): void {
        const nowMs = this.nowMs();
        for (const [entityId, pending] of this.pendingImpulseByEntity.entries()) {
            if (pending.expiresAtMs <= nowMs) {
                this.pendingImpulseByEntity.delete(entityId);
                continue;
            }

            const entity = this.context.runtime.entity.getEntity(entityId) as PhysicsPropEntity | undefined;
            if (!entity || entity.isDestroyed || !entity.rigidBody || entity.heldBy) {
                this.pendingImpulseByEntity.delete(entityId);
                continue;
            }

            if (!entity.isAuthority) {
                continue;
            }

            this.applyInteractionImpulseNow(entity, pending.impulse, pending.point, pending.options);
            this.pendingImpulseByEntity.delete(entityId);
        }
    }

    private applyInteractionImpulseNow(
        entity: PhysicsPropEntity,
        impulse: IVector3,
        point: IVector3,
        options?: IInteractionImpulseOptions
    ): boolean {
        const linearFactor = Math.max(0, options?.linearFactor ?? 1);
        const torqueFactor = Math.max(0, options?.torqueFactor ?? 0);

        entity.rigidBody.wakeUp();
        entity.rigidBody.applyImpulse(
            {
                x: impulse.x * linearFactor,
                y: impulse.y * linearFactor,
                z: impulse.z * linearFactor
            },
            true
        );

        if (torqueFactor > 0) {
            const center = entity.rigidBody.translation();
            const rx = point.x - center.x;
            const ry = point.y - center.y;
            const rz = point.z - center.z;
            entity.rigidBody.applyTorqueImpulse(
                {
                    x: ((ry * impulse.z) - (rz * impulse.y)) * torqueFactor,
                    y: ((rz * impulse.x) - (rx * impulse.z)) * torqueFactor,
                    z: ((rx * impulse.y) - (ry * impulse.x)) * torqueFactor
                },
                true
            );
        }

        this.context.runtime.network?.syncEntityNow(entity.id, true);
        return true;
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




