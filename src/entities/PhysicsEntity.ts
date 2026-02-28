import RAPIER from '@dimforge/rapier3d-compat';
import { NetworkEntity } from './NetworkEntity';
import { IInteractable } from '../interfaces/IInteractable';
import { IGrabbable } from '../interfaces/IGrabbable';
import { IInteractionEvent } from '../interfaces/IInteractionEvent';
import { IView } from '../interfaces/IView';
import { IVector3, IQuaternion, IPose } from '../interfaces/IMath';
import { PhysicsPropView, IPhysicsPropState } from '../views/PhysicsPropView';
import { IPhysicsEntityState, EntityType } from '../interfaces/IEntityState';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

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

export class PhysicsEntity extends NetworkEntity implements IInteractable, IGrabbable {
    public rigidBody: RAPIER.RigidBody;
    public view: IView<IPhysicsPropState> | null;
    public isGrabbable: boolean;
    public spawnPosition: IVector3 | null;
    public heldBy: string | null = null;

    private targetPos: IVector3 = { x: 0, y: 0, z: 0 };
    private targetRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private lerpFactor: number = 0.2;

    private simMode: PhysicsSimMode = PhysicsSimMode.AuthoritativeDynamic;

    private proxyRenderPos: IVector3 = { x: 0, y: 0, z: 0 };
    private proxyRenderRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private proxyInitialized: boolean = false;

    private presentPos: IVector3 = { x: 0, y: 0, z: 0 };
    private presentRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private snapshotBuffer: INetworkSnapshot[] = [];
    private interpolationDelayMs: number = 120;
    private maxExtrapolationMs: number = 80;
    private maxSnapshotAgeMs: number = 1500;
    private maxSnapshots: number = 64;
    private lastOwnershipTransferSeq: number = 0;

    constructor(protected context: GameContext, id: string, isAuthority: boolean, rigidBody: RAPIER.RigidBody, options: any = {}) {
        super(context, id, EntityType.PHYSICS_PROP, isAuthority);
        this.rigidBody = rigidBody;
        this.view = options.view || null;
        this.isGrabbable = options.grabbable || false;
        this.spawnPosition = options.spawnPosition ? { ...options.spawnPosition } : null;

        const pos = this.rigidBody.translation();
        const rot = this.rigidBody.rotation();
        this.targetPos = { x: pos.x, y: pos.y, z: pos.z };
        this.targetRot = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
        this.proxyRenderPos = { ...this.targetPos };
        this.proxyRenderRot = { ...this.targetRot };
        this.presentPos = { ...this.targetPos };
        this.presentRot = { ...this.targetRot };

        this.syncAuthority();
        this.refreshSimMode();
    }

    public getSimMode(): PhysicsSimMode {
        return this.simMode;
    }

    public getSnapshotBufferSize(): number {
        return this.snapshotBuffer.length;
    }

    public getLastOwnershipTransferSeq(): number {
        return this.lastOwnershipTransferSeq;
    }

    public syncAuthority(): void {
        const localId = this.context.localPlayer?.id || 'local';
        const shouldBeAuthority = (this.ownerId === localId) || (this.ownerId === null && this.context.isHost);

        if (this.isAuthority !== shouldBeAuthority) {
            this.onAuthorityChanged(shouldBeAuthority);
        }
    }

    public releasePhysicsOwnership(velocity?: IVector3): void {
        if (!this.isAuthority) return;

        this.rigidBody.wakeUp();
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        if (velocity && (Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1 || Math.abs(velocity.z) > 0.1)) {
            this.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
        }

        const localId = this.context.localPlayer?.id || 'local';
        if (this.context.isHost) {
            this.ownerId = null;
            this.syncAuthority();
            this.refreshSimMode();
        } else {
            // Keep local simulation alive until host sends OWNERSHIP_TRANSFER.
            this.ownerId = localId;
            this.isAuthority = true;
            this.setSimMode(PhysicsSimMode.PendingReleaseDynamic);
        }

        const state = this.getNetworkState();
        eventBus.emit(EVENTS.RELEASE_OWNERSHIP, {
            entityId: this.id,
            velocity: state.v,
            position: state.p,
            quaternion: state.q
        });
    }

    // --- IInteractable ---
    public onHoverEnter(playerId: string): void {
        if (this.view) this.view.setHighlight(true);
    }

    public onHoverExit(playerId: string): void {
        if (this.view) this.view.setHighlight(false);
    }

    public onInteraction(event: IInteractionEvent): void {
        // Implementation for tool usage
    }

    // --- IGrabbable ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        if (!this.rigidBody) return;
        this.requestOwnership();

        this.heldBy = playerId;
        this.refreshSimMode();
    }

    public onRelease(velocity?: IVector3): void {
        if (!this.rigidBody) return;
        this.heldBy = null;
        this.releasePhysicsOwnership(velocity);
    }

    public updateGrabbedPose(pose: IPose): void {
        this.targetPos = { ...pose.position };
        this.targetRot = { ...pose.quaternion };
        this.proxyRenderPos = { ...pose.position };
        this.proxyRenderRot = { ...pose.quaternion };
        this.presentPos = { ...pose.position };
        this.presentRot = { ...pose.quaternion };
        this.proxyInitialized = true;

        this.rigidBody.setNextKinematicTranslation(pose.position);
        this.rigidBody.setNextKinematicRotation(pose.quaternion);
    }

    public onNetworkEvent(type: string, payload: any): void {
        if (type === 'OWNERSHIP_RELEASE') {
            this.heldBy = null;
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

            if (payload.position) this.rigidBody.setTranslation({ x: payload.position[0], y: payload.position[1], z: payload.position[2] }, false);
            if (payload.quaternion) this.rigidBody.setRotation({ x: payload.quaternion[0], y: payload.quaternion[1], z: payload.quaternion[2], w: payload.quaternion[3] }, false);
            if (payload.velocity) {
                this.rigidBody.setLinvel({ x: payload.velocity[0], y: payload.velocity[1], z: payload.velocity[2] }, true);
            }

            this.rigidBody.wakeUp();
            this.refreshSimMode();
            return;
        }

        if (type === 'OWNERSHIP_TRANSFER') {
            const newOwnerId = payload?.newOwnerId ?? null;
            const localId = this.context.localPlayer?.id || 'local';
            const seq = typeof payload?.seq === 'number' ? payload.seq : 0;

            if (seq > 0 && seq <= this.lastOwnershipTransferSeq) return;
            if (seq > 0) this.lastOwnershipTransferSeq = seq;

            // Host ACK ended pending release.
            if (this.simMode === PhysicsSimMode.PendingReleaseDynamic && newOwnerId !== localId) {
                this.refreshSimMode();
            }
        }
    }

    public update(delta: number, _frame?: XRFrame): void {
        this.syncAuthority();
        this.refreshSimMode();

        switch (this.simMode) {
            case PhysicsSimMode.HeldKinematic: {
                this.rigidBody.setNextKinematicTranslation(this.targetPos);
                this.rigidBody.setNextKinematicRotation(this.targetRot);
                const position = this.rigidBody.translation();
                const rotation = this.rigidBody.rotation();
                this.presentPos = { x: position.x, y: position.y, z: position.z };
                this.presentRot = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
                break;
            }
            case PhysicsSimMode.AuthoritativeDynamic:
            case PhysicsSimMode.PendingReleaseDynamic: {
                const position = this.rigidBody.translation();
                const rotation = this.rigidBody.rotation();
                this.presentPos = { x: position.x, y: position.y, z: position.z };
                this.presentRot = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };

                if (
                    this.simMode === PhysicsSimMode.AuthoritativeDynamic &&
                    this.ownerId !== null &&
                    !this.context.isHost &&
                    this.rigidBody.isSleeping()
                ) {
                    this.releasePhysicsOwnership();
                }

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
                    this.proxyRenderPos.x += (this.targetPos.x - this.proxyRenderPos.x) * this.lerpFactor;
                    this.proxyRenderPos.y += (this.targetPos.y - this.proxyRenderPos.y) * this.lerpFactor;
                    this.proxyRenderPos.z += (this.targetPos.z - this.proxyRenderPos.z) * this.lerpFactor;
                    this.nlerpQuaternion(this.proxyRenderRot, this.targetRot, this.lerpFactor);
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

    public getNetworkState(fullSync: boolean = false): IPhysicsEntityState {
        const pos = this.rigidBody.translation();
        const rot = this.rigidBody.rotation();
        const vel = this.rigidBody.linvel();

        return {
            id: this.id,
            type: EntityType.PHYSICS_PROP,
            p: [pos.x, pos.y, pos.z],
            q: [rot.x, rot.y, rot.z, rot.w],
            v: [vel.x, vel.y, vel.z],
            b: this.heldBy,
            ownerId: this.ownerId
        };
    }

    public applyNetworkState(state: IPhysicsEntityState): void {
        this.syncNetworkState(state);

        if (this.isAuthority) return;

        const snapshot: INetworkSnapshot = {
            receivedAtMs: this.nowMs(),
            position: state.p ? { x: state.p[0], y: state.p[1], z: state.p[2] } : { ...this.targetPos },
            quaternion: state.q ? { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] } : { ...this.targetRot },
            velocity: state.v ? { x: state.v[0], y: state.v[1], z: state.v[2] } : { x: 0, y: 0, z: 0 },
            heldBy: state.b || null
        };
        this.snapshotBuffer.push(snapshot);

        if (this.snapshotBuffer.length > this.maxSnapshots) {
            this.snapshotBuffer.splice(0, this.snapshotBuffer.length - this.maxSnapshots);
        }

        const cutoff = snapshot.receivedAtMs - this.maxSnapshotAgeMs;
        while (this.snapshotBuffer.length > 1 && this.snapshotBuffer[0].receivedAtMs < cutoff) {
            this.snapshotBuffer.shift();
        }

        this.heldBy = snapshot.heldBy;
        this.targetPos = { ...snapshot.position };
        this.targetRot = { ...snapshot.quaternion };

        if (!this.proxyInitialized) {
            this.proxyRenderPos = { ...this.targetPos };
            this.proxyRenderRot = { ...this.targetRot };
            this.presentPos = this.proxyRenderPos;
            this.presentRot = this.proxyRenderRot;
            this.proxyInitialized = true;
        }
    }

    private refreshSimMode(): void {
        if (!this.isAuthority) {
            this.setSimMode(PhysicsSimMode.ProxyKinematic);
            return;
        }

        if (this.heldBy) {
            this.setSimMode(PhysicsSimMode.HeldKinematic);
            return;
        }

        if (!this.context.isHost && this.simMode === PhysicsSimMode.PendingReleaseDynamic) {
            this.setSimMode(PhysicsSimMode.PendingReleaseDynamic);
            return;
        }

        this.setSimMode(PhysicsSimMode.AuthoritativeDynamic);
    }

    private setSimMode(nextMode: PhysicsSimMode): void {
        if (this.simMode === nextMode) return;
        this.simMode = nextMode;

        switch (nextMode) {
            case PhysicsSimMode.HeldKinematic:
            case PhysicsSimMode.ProxyKinematic:
                this.rigidBody.wakeUp();
                this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
                this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                if (nextMode === PhysicsSimMode.ProxyKinematic && !this.proxyInitialized) {
                    this.proxyRenderPos = { ...this.targetPos };
                    this.proxyRenderRot = { ...this.targetRot };
                    this.proxyInitialized = true;
                }
                break;
            case PhysicsSimMode.AuthoritativeDynamic:
            case PhysicsSimMode.PendingReleaseDynamic:
                this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
                this.rigidBody.wakeUp();
                break;
        }
    }

    private updateProxyTargetFromBuffer(): void {
        if (this.snapshotBuffer.length === 0) return;

        const now = this.nowMs();
        const sampleTime = now - this.interpolationDelayMs;
        const sampled = this.sampleSnapshotAt(sampleTime);
        if (!sampled) return;

        this.targetPos = sampled.position;
        this.targetRot = sampled.quaternion;
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

    public destroy(): void {
        super.destroy();
        const render = this.context.managers.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
