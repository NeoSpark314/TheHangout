import RAPIER from '@dimforge/rapier3d-compat';
import { ReplicatedEntity } from './ReplicatedEntity';
import { IInteractable } from '../../shared/contracts/IInteractable';
import { IGrabbable } from '../../shared/contracts/IGrabbable';
import { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import { IView } from '../../shared/contracts/IView';
import { IVector3, IQuaternion, IPose } from '../../shared/contracts/IMath';
import { PhysicsPropView, IPhysicsPropState } from '../../render/views/PhysicsPropView';
import { IPhysicsEntityState, IEntityState, EntityType } from '../../shared/contracts/IEntityState';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import {
    resolvePhysicsReplicationProfile,
    type PhysicsPropShape,
    type PhysicsReplicationProfileId
} from '../../physics/runtime/PhysicsReplicationProfiles';

/**
 * Source of Truth: This entity owns the logic and physical state of a prop.
 * Visuals are applied in a dedicated post-physics presentation phase via `present(...)`.
 *
 * Explicit simulation modes:
 * - AuthoritativeDynamic: local authority, free rigid body simulation.
 * - HeldKinematic: local authority while grabbed.
 * - PendingReleaseDynamic: guest throw handoff window until host ownership transfer ACK.
 * - ProxyKinematic: non-authoritative network follower.
 */
export enum PhysicsSimMode {
    AuthoritativeDynamic = 'AuthoritativeDynamic',
    HeldKinematic = 'HeldKinematic',
    PendingReleaseDynamic = 'PendingReleaseDynamic',
    ProxyKinematic = 'ProxyKinematic'
}

interface INetworkSnapshot {
    receivedAtMs: number;
    position: IVector3;
    quaternion: IQuaternion;
    velocity: IVector3;
    heldBy: string | null;
}

export class PhysicsPropEntity extends ReplicatedEntity implements IInteractable, IGrabbable {
    public rigidBody: RAPIER.RigidBody;
    public view: IView<IPhysicsPropState> | null;
    public isHoldable: boolean;
    public isGrabbable: boolean;
    private hoverSources: Set<string> = new Set();
    public spawnPosition: IVector3 | null;
    public heldBy: string | null = null;
    private grabRadius: number;
    public halfExtents?: IVector3;
    public moduleId?: string;

    private targetPos: IVector3 = { x: 0, y: 0, z: 0 };
    private targetRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private lerpFactor: number = 0.2;
    private heldLerpFactor: number = 0.5;

    private simMode: PhysicsSimMode = PhysicsSimMode.AuthoritativeDynamic;

    private proxyRenderPos: IVector3 = { x: 0, y: 0, z: 0 };
    private proxyRenderRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private proxyInitialized: boolean = false;

    protected presentPos: IVector3 = { x: 0, y: 0, z: 0 };
    protected presentRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private snapshotBuffer: INetworkSnapshot[] = [];
    private interpolationDelayMs: number = 120;
    private maxExtrapolationMs: number = 80;
    private maxSnapshotAgeMs: number = 1500;
    private maxSnapshots: number = 64;
    private replicationProfileId: PhysicsReplicationProfileId = 'default-prop';
    private allowSpeculativeHostClaim = true;
    private touchLeaseEligible = true;
    private pendingReleaseMinHoldMs = 220;
    private pendingReleaseMaxHoldMs = 900;
    private pendingReleaseLinearSpeedThreshold = 0.4;
    private pendingReleaseAngularSpeedThreshold = 0.9;

    private lastSyncPos: IVector3 = { x: 0, y: 0, z: 0 };
    private lastSyncRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private lastSyncAwake: boolean = true;
    private lastSyncHeldBy: string | null = null;
    private lastSyncOwnerId: string | null = null;
    private lastSyncScale: number = 1;
    private uniformScale: number = 1;
    private dualGrabScalable: boolean = false;
    private baseHalfExtents: IVector3 | null = null;
    private minScale: number = 0.25;
    private maxScale: number = 3.0;

    constructor(protected context: AppContext, id: string, isAuthority: boolean, rigidBody: RAPIER.RigidBody, options: any = {}) {
        super(context, id, options.type || EntityType.PHYSICS_PROP, isAuthority);
        this.rigidBody = rigidBody;
        this.view = options.view || null;
        this.isHoldable = options.grabbable || false;
        this.isGrabbable = options.grabbable || false;
        this.spawnPosition = options.spawnPosition ? { ...options.spawnPosition } : null;
        this.grabRadius = Math.max(0.03, options.grabRadius ?? 0.06);
        this.halfExtents = options.halfExtents;
        this.baseHalfExtents = options.halfExtents ? { ...options.halfExtents } : null;
        this.moduleId = options.moduleId;
        this.ownerId = options.ownerId !== undefined ? options.ownerId : null;
        this.dualGrabScalable = options.dualGrabScalable === true;
        const replicationProfile = resolvePhysicsReplicationProfile(
            options.replicationProfileId,
            (options.shape as PhysicsPropShape | undefined) ?? 'box'
        );
        this.replicationProfileId = replicationProfile.id;
        this.interpolationDelayMs = replicationProfile.interpolationDelayMs;
        this.maxExtrapolationMs = replicationProfile.maxExtrapolationMs;
        this.maxSnapshotAgeMs = replicationProfile.maxSnapshotAgeMs;
        this.lerpFactor = replicationProfile.lerpFactor;
        this.heldLerpFactor = replicationProfile.heldLerpFactor;
        this.pendingReleaseMinHoldMs = replicationProfile.pendingReleaseMinHoldMs;
        this.pendingReleaseMaxHoldMs = replicationProfile.pendingReleaseMaxHoldMs;
        this.pendingReleaseLinearSpeedThreshold = replicationProfile.pendingReleaseLinearSpeedThreshold;
        this.pendingReleaseAngularSpeedThreshold = replicationProfile.pendingReleaseAngularSpeedThreshold;
        this.allowSpeculativeHostClaim = replicationProfile.allowSpeculativeHostClaim;
        this.touchLeaseEligible = replicationProfile.touchLeaseEligible;
        if (typeof options.minScale === 'number' && Number.isFinite(options.minScale)) {
            this.minScale = Math.max(0.05, options.minScale);
        }
        if (typeof options.maxScale === 'number' && Number.isFinite(options.maxScale)) {
            this.maxScale = Math.max(this.minScale, options.maxScale);
        }
        if (typeof options.initialScale === 'number' && Number.isFinite(options.initialScale)) {
            this.uniformScale = Math.max(this.minScale, Math.min(this.maxScale, options.initialScale));
        }
        if (options.url) {
            // Some objects might use this directly if they don't have a separate Instance class
            (this as any).url = options.url;
        }

        const pos = this.rigidBody.translation();
        const rot = this.rigidBody.rotation();
        this.targetPos = { x: pos.x, y: pos.y, z: pos.z };
        this.targetRot = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
        this.proxyRenderPos = { ...this.targetPos };
        this.proxyRenderRot = { ...this.targetRot };
        this.presentPos = { ...this.targetPos };
        this.presentRot = { ...this.targetRot };
        this.applyVisualScale();
        this.applyScaledCollider();

        this.syncAuthority();
    }

    private setVec3(out: IVector3, x: number, y: number, z: number): void {
        out.x = x;
        out.y = y;
        out.z = z;
    }

    private copyVec3(out: IVector3, src: IVector3): void {
        out.x = src.x;
        out.y = src.y;
        out.z = src.z;
    }

    private setQuat(out: IQuaternion, x: number, y: number, z: number, w: number): void {
        out.x = x;
        out.y = y;
        out.z = z;
        out.w = w;
    }

    private copyQuat(out: IQuaternion, src: IQuaternion): void {
        out.x = src.x;
        out.y = src.y;
        out.z = src.z;
        out.w = src.w;
    }

    public getSimMode(): PhysicsSimMode {
        return this.simMode;
    }

    public getSnapshotBufferSize(): number {
        return this.snapshotBuffer.length;
    }

    public getLastOwnershipTransferSeq(): number {
        return this.context.runtime.physicsAuthority.getLastOwnershipTransferSeq(this.id);
    }

    public getReplicationProfileId(): PhysicsReplicationProfileId {
        return this.replicationProfileId;
    }

    public getPendingReleaseMinHoldMs(): number {
        return this.pendingReleaseMinHoldMs;
    }

    public getPendingReleaseMaxHoldMs(): number {
        return this.pendingReleaseMaxHoldMs;
    }

    public getPendingReleaseLinearSpeedThreshold(): number {
        return this.pendingReleaseLinearSpeedThreshold;
    }

    public getPendingReleaseAngularSpeedThreshold(): number {
        return this.pendingReleaseAngularSpeedThreshold;
    }

    public setPendingReleaseHoldWindow(minMs: number, maxMs: number): void {
        const clampedMin = Math.max(0, Math.floor(minMs));
        const clampedMax = Math.max(clampedMin + 50, Math.floor(maxMs));
        this.pendingReleaseMinHoldMs = clampedMin;
        this.pendingReleaseMaxHoldMs = clampedMax;
    }

    public allowsSpeculativeHostClaim(): boolean {
        return this.allowSpeculativeHostClaim;
    }

    public allowsTouchOwnershipLease(): boolean {
        return this.touchLeaseEligible;
    }

    public syncAuthority(): void {
        this.context.runtime.physicsAuthority.syncEntityAuthority(this);
    }

    public releasePhysicsOwnership(velocity?: IVector3): void {
        this.context.runtime.physicsAuthority.releaseEntityOwnership(this, velocity);
    }

    // --- IInteractable ---
    public onHoverEnter(playerId: string): void {
        this.hoverSources.add(playerId);
        if (this.view) this.view.setHighlight(true);
    }

    public onHoverExit(playerId: string): void {
        this.hoverSources.delete(playerId);
        if (this.view) this.view.setHighlight(this.hoverSources.size > 0);
    }

    public onInteraction(event: IInteractionEvent): void {
        // Implementation for tool usage
    }

    // --- IGrabbable ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        if (!this.rigidBody) return;
        const hasAuthority = this.requestImmediatePhysicsAuthority();
        if (!hasAuthority) return;

        this.heldBy = playerId;
        this.syncAuthority();
        this.context.runtime.network?.syncEntityNow(this.id);
    }

    public onRelease(velocity?: IVector3): void {
        if (!this.rigidBody) return;
        this.heldBy = null;
        this.releasePhysicsOwnership(velocity);
    }

    public getGrabRadius(): number {
        return this.grabRadius;
    }

    public supportsDualGrabScale(): boolean {
        return this.dualGrabScalable;
    }

    public getUniformScale(): number {
        return this.uniformScale;
    }

    public getDualGrabScaleLimits(): { min: number; max: number } {
        return { min: this.minScale, max: this.maxScale };
    }

    public getBaseHalfExtents(): IVector3 | null {
        return this.baseHalfExtents ? { ...this.baseHalfExtents } : null;
    }

    public setBaseHalfExtents(halfExtents: IVector3): void {
        this.baseHalfExtents = { ...halfExtents };
        this.applyScaledCollider();
    }

    public setUniformScale(scale: number): void {
        if (!this.dualGrabScalable || !Number.isFinite(scale)) return;
        const clamped = Math.max(this.minScale, Math.min(this.maxScale, scale));
        if (Math.abs(clamped - this.uniformScale) < 0.0001) return;
        this.uniformScale = clamped;
        this.applyVisualScale();
        this.applyScaledCollider();
    }

    public updateGrabbedPose(pose: IPose): void {
        this.copyVec3(this.targetPos, pose.position);
        this.copyQuat(this.targetRot, pose.quaternion);
        this.copyVec3(this.proxyRenderPos, pose.position);
        this.copyQuat(this.proxyRenderRot, pose.quaternion);
        this.copyVec3(this.presentPos, pose.position);
        this.copyQuat(this.presentRot, pose.quaternion);
        this.proxyInitialized = true;

        this.rigidBody.setNextKinematicTranslation(pose.position);
        this.rigidBody.setNextKinematicRotation(pose.quaternion);
    }

    public requestImmediatePhysicsAuthority(options?: { allowSpeculativeHostClaim?: boolean }): boolean {
        return this.context.runtime.physicsAuthority.requestImmediateAuthority(this, options);
    }

    public onNetworkEvent(type: string, payload: any): void {
        this.context.runtime.physicsAuthority.handleNetworkEvent(this, type, payload);
    }

    public update(delta: number, _frame?: XRFrame): void {
        this.context.runtime.physicsAuthority.prepareEntityForUpdate(this);

        switch (this.simMode) {
            case PhysicsSimMode.HeldKinematic: {
                this.rigidBody.setNextKinematicTranslation(this.targetPos);
                this.rigidBody.setNextKinematicRotation(this.targetRot);
                const position = this.rigidBody.translation();
                const rotation = this.rigidBody.rotation();
                this.setVec3(this.presentPos, position.x, position.y, position.z);
                this.setQuat(this.presentRot, rotation.x, rotation.y, rotation.z, rotation.w);
                break;
            }
            case PhysicsSimMode.AuthoritativeDynamic:
            case PhysicsSimMode.PendingReleaseDynamic: {
                const position = this.rigidBody.translation();
                const rotation = this.rigidBody.rotation();
                this.setVec3(this.presentPos, position.x, position.y, position.z);
                this.setQuat(this.presentRot, rotation.x, rotation.y, rotation.z, rotation.w);

                if (this.isGrabbable && !this.heldBy && this.spawnPosition && position.y < -10) {
                    this.rigidBody.setTranslation(
                        { x: this.spawnPosition.x, y: this.spawnPosition.y, z: this.spawnPosition.z },
                        true
                    );
                    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                    this.rigidBody.wakeUp();
                }
                break;
            }
            case PhysicsSimMode.ProxyKinematic: {
                this.updateProxyTargetFromBuffer();
                this.rigidBody.setNextKinematicTranslation({ x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z });
                this.rigidBody.setNextKinematicRotation({ x: this.targetRot.x, y: this.targetRot.y, z: this.targetRot.z, w: this.targetRot.w });

                if (!this.proxyInitialized) {
                    this.proxyRenderPos = { ...this.targetPos };
                    this.proxyRenderRot = { ...this.targetRot };
                    this.proxyInitialized = true;
                } else {
                    const followLerp = this.heldBy ? this.heldLerpFactor : this.lerpFactor;
                    this.proxyRenderPos.x += (this.targetPos.x - this.proxyRenderPos.x) * followLerp;
                    this.proxyRenderPos.y += (this.targetPos.y - this.proxyRenderPos.y) * followLerp;
                    this.proxyRenderPos.z += (this.targetPos.z - this.proxyRenderPos.z) * followLerp;
                    this.nlerpQuaternion(this.proxyRenderRot, this.targetRot, followLerp);
                }

                this.presentPos = this.proxyRenderPos;
                this.presentRot = this.proxyRenderRot;
                break;
            }
        }
    }

    public present(delta: number): void {
        if (!this.view) return;
        this.view.applyState({
            position: this.presentPos,
            quaternion: this.presentRot,
            lerpFactor: 1.0
        }, delta);
    }

    public getNetworkState(fullSync: boolean = false): Partial<IEntityState> | null {
        const isHeldAuthoritative = this.isAuthority && !!this.heldBy;
        const isAwake = isHeldAuthoritative ? true : !this.rigidBody.isSleeping();
        const rbPos = this.rigidBody.translation();
        const rbRot = this.rigidBody.rotation();
        const rbVel = this.rigidBody.linvel();
        const pos = isHeldAuthoritative
            ? { x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z }
            : { x: rbPos.x, y: rbPos.y, z: rbPos.z };
        const rot = isHeldAuthoritative
            ? { x: this.targetRot.x, y: this.targetRot.y, z: this.targetRot.z, w: this.targetRot.w }
            : { x: rbRot.x, y: rbRot.y, z: rbRot.z, w: rbRot.w };
        const vel = isHeldAuthoritative
            ? { x: 0, y: 0, z: 0 }
            : { x: rbVel.x, y: rbVel.y, z: rbVel.z };

        if (!fullSync) {
            const posChanged = Math.abs(pos.x - this.lastSyncPos.x) > 0.001 ||
                Math.abs(pos.y - this.lastSyncPos.y) > 0.001 ||
                Math.abs(pos.z - this.lastSyncPos.z) > 0.001;

            const rotChanged = Math.abs(rot.x - this.lastSyncRot.x) > 0.001 ||
                Math.abs(rot.y - this.lastSyncRot.y) > 0.001 ||
                Math.abs(rot.z - this.lastSyncRot.z) > 0.001 ||
                Math.abs(rot.w - this.lastSyncRot.w) > 0.001;

            const stateChanged = isAwake !== this.lastSyncAwake ||
                this.heldBy !== this.lastSyncHeldBy ||
                this.ownerId !== this.lastSyncOwnerId ||
                (this.dualGrabScalable && Math.abs(this.uniformScale - this.lastSyncScale) > 0.0001);

            if (!isAwake && !posChanged && !rotChanged && !stateChanged) {
                return null;
            }
        }

        this.lastSyncPos = { x: pos.x, y: pos.y, z: pos.z };
        this.lastSyncRot = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
        this.lastSyncAwake = isAwake;
        this.lastSyncHeldBy = this.heldBy;
        this.lastSyncOwnerId = this.ownerId;
        this.lastSyncScale = this.uniformScale;

        return {
            id: this.id,
            type: EntityType.PHYSICS_PROP,
            p: [pos.x, pos.y, pos.z],
            q: [rot.x, rot.y, rot.z, rot.w],
            v: [vel.x, vel.y, vel.z],
            b: this.heldBy,
            ownerId: this.ownerId,
            m: this.moduleId,
            he: this.baseHalfExtents
                ? [this.baseHalfExtents.x, this.baseHalfExtents.y, this.baseHalfExtents.z]
                : (this.halfExtents ? [this.halfExtents.x, this.halfExtents.y, this.halfExtents.z] : undefined),
            s: this.dualGrabScalable ? this.uniformScale : undefined
        } as IPhysicsEntityState;
    }

    public applyNetworkState(state: Partial<IEntityState>): void {
        const prevOwnerId = this.ownerId;
        const prevHeldBy = this.heldBy;
        this.syncNetworkState(state);

        if (this.isAuthority) return;

        const propState = state as Partial<IPhysicsEntityState>;
        if (propState.he && propState.he.length === 3) {
            const incomingBaseHalfExtents = { x: propState.he[0], y: propState.he[1], z: propState.he[2] };
            if (!this.baseHalfExtents || this.hasSignificantExtentsDelta(this.baseHalfExtents, incomingBaseHalfExtents)) {
                this.setBaseHalfExtents(incomingBaseHalfExtents);
            }
        }

        const snapshot: INetworkSnapshot = {
            receivedAtMs: this.nowMs(),
            position: propState.p ? { x: propState.p[0], y: propState.p[1], z: propState.p[2] } : { ...this.targetPos },
            quaternion: propState.q ? { x: propState.q[0], y: propState.q[1], z: propState.q[2], w: propState.q[3] } : { ...this.targetRot },
            velocity: propState.v ? { x: propState.v[0], y: propState.v[1], z: propState.v[2] } : { x: 0, y: 0, z: 0 },
            heldBy: propState.b || null
        };

        const ownerChanged = this.ownerId !== prevOwnerId;
        const heldChanged = snapshot.heldBy !== prevHeldBy;
        if (ownerChanged || heldChanged) {
            this.clearSnapshotBuffer();
        }
        this.snapshotBuffer.push(snapshot);

        if (this.snapshotBuffer.length > this.maxSnapshots) {
            this.snapshotBuffer.splice(0, this.snapshotBuffer.length - this.maxSnapshots);
        }

        const cutoff = snapshot.receivedAtMs - this.maxSnapshotAgeMs;
        while (this.snapshotBuffer.length > 1 && this.snapshotBuffer[0].receivedAtMs < cutoff) {
            this.snapshotBuffer.shift();
        }

        this.heldBy = snapshot.heldBy;
        if (this.dualGrabScalable && typeof propState.s === 'number' && Number.isFinite(propState.s)) {
            this.uniformScale = Math.max(this.minScale, Math.min(this.maxScale, propState.s));
            this.applyVisualScale();
            this.applyScaledCollider();
        }
        this.copyVec3(this.targetPos, snapshot.position);
        this.copyQuat(this.targetRot, snapshot.quaternion);

        if (!this.proxyInitialized) {
            this.copyVec3(this.proxyRenderPos, this.targetPos);
            this.copyQuat(this.proxyRenderRot, this.targetRot);
            this.copyVec3(this.presentPos, this.proxyRenderPos);
            this.copyQuat(this.presentRot, this.proxyRenderRot);
            this.proxyInitialized = true;
        }
    }

    public applyAuthoritySimMode(nextMode: PhysicsSimMode): void {
        this.setSimMode(nextMode);
    }

    private setSimMode(nextMode: PhysicsSimMode): void {
        if (this.simMode === nextMode) return;
        const prevMode = this.simMode;
        this.simMode = nextMode;

        switch (nextMode) {
            case PhysicsSimMode.HeldKinematic:
            case PhysicsSimMode.ProxyKinematic:
                this.rigidBody.wakeUp();
                this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
                this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                if (nextMode === PhysicsSimMode.ProxyKinematic && prevMode !== PhysicsSimMode.ProxyKinematic) {
                    // On authority -> proxy transition, drop stale snapshots and seed from current pose.
                    this.clearSnapshotBuffer();
                    this.seedSnapshotFromCurrentPose();
                    this.copyVec3(this.proxyRenderPos, this.targetPos);
                    this.copyQuat(this.proxyRenderRot, this.targetRot);
                    this.copyVec3(this.presentPos, this.proxyRenderPos);
                    this.copyQuat(this.presentRot, this.proxyRenderRot);
                    this.proxyInitialized = true;
                }
                break;
            case PhysicsSimMode.AuthoritativeDynamic:
            case PhysicsSimMode.PendingReleaseDynamic:
                this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
                this.rigidBody.wakeUp();
                if (prevMode === PhysicsSimMode.ProxyKinematic) {
                    // Avoid replaying old remote snapshots after reclaiming authority.
                    this.clearSnapshotBuffer();
                }
                break;
        }
    }

    private updateProxyTargetFromBuffer(): void {
        if (this.snapshotBuffer.length === 0) return;

        const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1];
        if (latest.heldBy) {
            this.copyVec3(this.targetPos, latest.position);
            this.copyQuat(this.targetRot, latest.quaternion);
            this.heldBy = latest.heldBy;
            return;
        }

        const now = this.nowMs();
        const sampleTime = now - this.interpolationDelayMs;
        const sampled = this.sampleSnapshotAt(sampleTime);
        if (!sampled) return;

        this.copyVec3(this.targetPos, sampled.position);
        this.copyQuat(this.targetRot, sampled.quaternion);
        this.heldBy = sampled.heldBy;
    }

    private sampleSnapshotAt(targetTimeMs: number): INetworkSnapshot | null {
        const snapshots = this.snapshotBuffer;
        if (snapshots.length === 0) return null;
        if (snapshots.length === 1) return snapshots[0];

        for (let i = 0; i < snapshots.length - 1; i++) {
            const a = snapshots[i];
            const b = snapshots[i + 1];
            if (targetTimeMs >= a.receivedAtMs && targetTimeMs <= b.receivedAtMs) {
                const span = Math.max(1, b.receivedAtMs - a.receivedAtMs);
                const t = (targetTimeMs - a.receivedAtMs) / span;
                return {
                    receivedAtMs: targetTimeMs,
                    position: {
                        x: a.position.x + (b.position.x - a.position.x) * t,
                        y: a.position.y + (b.position.y - a.position.y) * t,
                        z: a.position.z + (b.position.z - a.position.z) * t
                    },
                    quaternion: this.nlerpQuaternionNew(a.quaternion, b.quaternion, t),
                    velocity: {
                        x: a.velocity.x + (b.velocity.x - a.velocity.x) * t,
                        y: a.velocity.y + (b.velocity.y - a.velocity.y) * t,
                        z: a.velocity.z + (b.velocity.z - a.velocity.z) * t
                    },
                    heldBy: b.heldBy
                };
            }
        }

        const last = snapshots[snapshots.length - 1];
        const dtMs = Math.min(this.maxExtrapolationMs, Math.max(0, targetTimeMs - last.receivedAtMs));
        const dt = dtMs / 1000;
        return {
            receivedAtMs: targetTimeMs,
            position: {
                x: last.position.x + last.velocity.x * dt,
                y: last.position.y + last.velocity.y * dt,
                z: last.position.z + last.velocity.z * dt
            },
            quaternion: { ...last.quaternion },
            velocity: { ...last.velocity },
            heldBy: last.heldBy
        };
    }

    private nlerpQuaternion(current: IQuaternion, target: IQuaternion, t: number): void {
        let tx = target.x;
        let ty = target.y;
        let tz = target.z;
        let tw = target.w;

        const dot = current.x * tx + current.y * ty + current.z * tz + current.w * tw;
        if (dot < 0) {
            tx = -tx;
            ty = -ty;
            tz = -tz;
            tw = -tw;
        }

        const it = 1 - t;
        current.x = it * current.x + t * tx;
        current.y = it * current.y + t * ty;
        current.z = it * current.z + t * tz;
        current.w = it * current.w + t * tw;

        const len = Math.hypot(current.x, current.y, current.z, current.w) || 1;
        current.x /= len;
        current.y /= len;
        current.z /= len;
        current.w /= len;
    }

    private nlerpQuaternionNew(a: IQuaternion, b: IQuaternion, t: number): IQuaternion {
        const out: IQuaternion = { x: a.x, y: a.y, z: a.z, w: a.w };
        this.nlerpQuaternion(out, b, t);
        return out;
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    private applyVisualScale(): void {
        const mesh = this.view?.mesh;
        if (!mesh) return;
        mesh.scale.set(this.uniformScale, this.uniformScale, this.uniformScale);
    }

    private applyScaledCollider(): void {
        const runtimePhysics = this.context.runtime.physics;
        if (!runtimePhysics) return;

        const source = this.baseHalfExtents ?? this.halfExtents;
        if (!source) return;

        const scaled = this.dualGrabScalable
            ? {
                x: source.x * this.uniformScale,
                y: source.y * this.uniformScale,
                z: source.z * this.uniformScale
            }
            : { ...source };

        runtimePhysics.updateGrabbableCollider(this.id, undefined, 0.5, scaled);
        this.halfExtents = scaled;
    }

    private hasSignificantExtentsDelta(a: IVector3, b: IVector3): boolean {
        const eps = 0.0001;
        return Math.abs(a.x - b.x) > eps || Math.abs(a.y - b.y) > eps || Math.abs(a.z - b.z) > eps;
    }

    public emitOwnershipRelease(): void {
        const state = this.getNetworkState(true) as Partial<IPhysicsEntityState>;
        if (state) {
            const angularVelocity = this.rigidBody.angvel();
            eventBus.emit(EVENTS.RELEASE_OWNERSHIP, {
                entityId: this.id,
                velocity: state.v,
                angularVelocity: [angularVelocity.x, angularVelocity.y, angularVelocity.z],
                position: state.p,
                quaternion: state.q
            });
        }
    }

    private clearSnapshotBuffer(): void {
        this.snapshotBuffer.length = 0;
    }

    private seedSnapshotFromCurrentPose(): void {
        const position = this.rigidBody.translation();
        const rotation = this.rigidBody.rotation();
        const velocity = this.rigidBody.linvel();

        const snapshot: INetworkSnapshot = {
            receivedAtMs: this.nowMs(),
            position: { x: position.x, y: position.y, z: position.z },
            quaternion: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
            velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
            heldBy: this.heldBy
        };

        this.snapshotBuffer.push(snapshot);
        this.copyVec3(this.targetPos, snapshot.position);
        this.copyQuat(this.targetRot, snapshot.quaternion);
    }

    public destroy(): void {
        this.context.runtime.physicsAuthority.forgetEntity(this.id);
        super.destroy();
        const render = this.context.runtime.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
