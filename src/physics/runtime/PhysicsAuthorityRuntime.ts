import RAPIER from '@dimforge/rapier3d-compat';
import type { AppContext } from '../../app/AppContext';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { IOwnershipReleasePayload, IOwnershipTransferPayload } from '../../shared/contracts/INetworkPacket';
import { PhysicsSimMode, type PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';

interface IPendingReleaseState {
    startedAtMs: number;
    armed: boolean;
}

interface ILocalAuthorityState {
    acquiredAtMs: number;
    observedAwake: boolean;
}

export class PhysicsAuthorityRuntime {
    private readonly pendingReleaseByEntity = new Map<string, IPendingReleaseState>();
    private readonly lastOwnershipTransferSeqByEntity = new Map<string, number>();
    private readonly lastTouchClaimAtMsByEntity = new Map<string, number>();
    private readonly localAuthorityByEntity = new Map<string, ILocalAuthorityState>();
    private touchLeaseClaimIntervalMs = 250;
    private touchLeaseProximityDistance = 0.55;
    private pendingReleaseMinHoldMs = 220;
    private pendingReleaseMaxHoldMs = 900;
    private guestSleepReleaseGraceMs = 250;

    constructor(private readonly context: AppContext) { }

    public getLastOwnershipTransferSeq(entityId: string): number {
        return this.lastOwnershipTransferSeqByEntity.get(entityId) ?? 0;
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
    }

    public syncEntityAuthority(entity: PhysicsPropEntity): void {
        const shouldBeAuthority = this.shouldEntityBeAuthority(entity);
        if (entity.isAuthority !== shouldBeAuthority) {
            entity.onAuthorityChanged(shouldBeAuthority);
        }

        this.applyResolvedSimMode(entity);
    }

    public prepareEntityForUpdate(entity: PhysicsPropEntity): void {
        const pendingRelease = this.pendingReleaseByEntity.get(entity.id);
        if (pendingRelease?.armed) {
            const dt = this.nowMs() - pendingRelease.startedAtMs;
            const reachedMin = dt >= entity.getPendingReleaseMinHoldMs();
            const reachedMax = dt >= entity.getPendingReleaseMaxHoldMs();
            const linearVelocity = entity.rigidBody.linvel();
            const angularVelocity = entity.rigidBody.angvel();
            const linearSpeed = Math.hypot(linearVelocity.x, linearVelocity.y, linearVelocity.z);
            const angularSpeed = Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z);
            const isSettledEnough =
                linearSpeed <= entity.getPendingReleaseLinearSpeedThreshold() &&
                angularSpeed <= entity.getPendingReleaseAngularSpeedThreshold();

            if (reachedMin && (entity.rigidBody.isSleeping() || isSettledEnough || reachedMax)) {
                pendingRelease.armed = false;
                entity.emitOwnershipRelease();
            }
        }

        this.syncEntityAuthority(entity);
        const localAuthorityState = this.refreshLocalAuthorityState(entity);

        const localId = this.context.localPlayer?.id || 'local';
        const isSettledLocalLease =
            entity.getSimMode() === PhysicsSimMode.AuthoritativeDynamic &&
            entity.ownerId === localId &&
            !entity.heldBy &&
            entity.rigidBody.isSleeping();

        // Host-owned transient interactions should decay back to the unowned-host
        // baseline once the prop settles so guests can claim it cleanly.
        if (this.context.isHost && isSettledLocalLease) {
            this.releaseEntityOwnership(entity);
            return;
        }

        if (
            entity.getSimMode() === PhysicsSimMode.AuthoritativeDynamic &&
            entity.ownerId !== null &&
            !this.context.isHost &&
            entity.rigidBody.isSleeping() &&
            (
                localAuthorityState?.observedAwake === true ||
                (
                    localAuthorityState !== null &&
                    (this.nowMs() - localAuthorityState.acquiredAtMs) >= this.guestSleepReleaseGraceMs
                )
            )
        ) {
            this.releaseEntityOwnership(entity);
        }
    }

    public requestImmediateAuthority(
        entity: PhysicsPropEntity,
        options?: { allowSpeculativeHostClaim?: boolean }
    ): boolean {
        if (!entity.rigidBody) return false;

        const hasAuthority = entity.requestOwnership();
        if (!hasAuthority || !entity.isAuthority) {
            const localId = this.context.localPlayer?.id || 'local';
            const hostId = this.context.sessionId;
            const allowSpeculativeHostClaim = options?.allowSpeculativeHostClaim === true;
            const canSpeculativelyClaimHostAuthority =
                allowSpeculativeHostClaim &&
                entity.allowsSpeculativeHostClaim() &&
                !this.context.isHost &&
                !entity.heldBy &&
                !!hostId &&
                entity.ownerId === hostId;

            if (!canSpeculativelyClaimHostAuthority) return false;

            entity.ownerId = localId;
            entity.isAuthority = true;
        }

        this.clearPendingRelease(entity.id);
        this.applyResolvedSimMode(entity);
        entity.rigidBody.wakeUp();
        return true;
    }

    public releaseEntityOwnership(entity: PhysicsPropEntity, velocity?: IVector3): void {
        if (!entity.isAuthority) return;

        entity.rigidBody.wakeUp();
        entity.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        if (velocity && (Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1 || Math.abs(velocity.z) > 0.1)) {
            entity.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
        }

        const localId = this.context.localPlayer?.id || 'local';
        if (this.context.isHost) {
            entity.ownerId = null;
            this.clearPendingRelease(entity.id);
            this.syncEntityAuthority(entity);
            entity.emitOwnershipRelease();
            return;
        }

        entity.ownerId = localId;
        entity.isAuthority = true;
        this.pendingReleaseByEntity.set(entity.id, {
            startedAtMs: this.nowMs(),
            armed: true
        });
        this.applyResolvedSimMode(entity);
    }

    public handleNetworkEvent(entity: PhysicsPropEntity, type: string, payload: unknown): void {
        if (type === 'OWNERSHIP_RELEASE') {
            this.handleOwnershipRelease(entity, payload as IOwnershipReleasePayload);
            return;
        }

        if (type === 'OWNERSHIP_TRANSFER') {
            this.handleOwnershipTransfer(entity, payload as IOwnershipTransferPayload);
        }
    }

    public tryClaimTouchLease(target: PhysicsPropEntity, nowMs: number, localId: string): void {
        if (target.isDestroyed) return;
        if (!target.allowsTouchOwnershipLease()) return;
        if (target.heldBy && target.heldBy !== localId) return;
        if (target.ownerId === localId || target.isAuthority) return;

        const lastClaimAt = this.lastTouchClaimAtMsByEntity.get(target.id) ?? 0;
        if ((nowMs - lastClaimAt) < this.touchLeaseClaimIntervalMs) return;

        this.lastTouchClaimAtMsByEntity.set(target.id, nowMs);
        target.requestOwnership();
    }

    public forgetEntity(entityId: string): void {
        this.pendingReleaseByEntity.delete(entityId);
        this.lastOwnershipTransferSeqByEntity.delete(entityId);
        this.lastTouchClaimAtMsByEntity.delete(entityId);
        this.localAuthorityByEntity.delete(entityId);
    }

    private handleOwnershipRelease(entity: PhysicsPropEntity, payload: IOwnershipReleasePayload): void {
        entity.heldBy = null;
        entity.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

        if (payload.position) {
            entity.rigidBody.setTranslation({ x: payload.position[0], y: payload.position[1], z: payload.position[2] }, false);
        }
        if (payload.quaternion) {
            entity.rigidBody.setRotation({
                x: payload.quaternion[0],
                y: payload.quaternion[1],
                z: payload.quaternion[2],
                w: payload.quaternion[3]
            }, false);
        }
        if (payload.velocity) {
            entity.rigidBody.setLinvel({ x: payload.velocity[0], y: payload.velocity[1], z: payload.velocity[2] }, true);
        }
        if (payload.angularVelocity) {
            entity.rigidBody.setAngvel({ x: payload.angularVelocity[0], y: payload.angularVelocity[1], z: payload.angularVelocity[2] }, true);
        }

        entity.rigidBody.wakeUp();
        this.clearPendingRelease(entity.id);
        this.applyResolvedSimMode(entity);
    }

    private handleOwnershipTransfer(entity: PhysicsPropEntity, payload: IOwnershipTransferPayload): void {
        const newOwnerId = payload?.newOwnerId ?? null;
        const localId = this.context.localPlayer?.id || 'local';
        const seq = typeof payload?.seq === 'number' ? payload.seq : 0;
        const lastSeq = this.lastOwnershipTransferSeqByEntity.get(entity.id) ?? 0;

        if (seq > 0 && seq <= lastSeq) return;
        if (seq > 0) {
            this.lastOwnershipTransferSeqByEntity.set(entity.id, seq);
        }

        const pendingRelease = this.pendingReleaseByEntity.get(entity.id);
        if (pendingRelease && newOwnerId !== localId) {
            this.clearPendingRelease(entity.id);
        }

        if (!entity.isAuthority && newOwnerId === null) {
            entity.resetProxyFollowStateFromCurrentPose();
        }

        this.applyResolvedSimMode(entity);
    }

    private shouldEntityBeAuthority(entity: PhysicsPropEntity): boolean {
        const localId = this.context.localPlayer?.id || 'local';
        return (entity.ownerId === localId) || (entity.ownerId === null && this.context.isHost);
    }

    private applyResolvedSimMode(entity: PhysicsPropEntity): void {
        if (!entity.isAuthority) {
            entity.applyAuthoritySimMode(PhysicsSimMode.ProxyKinematic);
            return;
        }

        if (entity.heldBy) {
            entity.applyAuthoritySimMode(PhysicsSimMode.HeldKinematic);
            return;
        }

        if (!this.context.isHost && this.pendingReleaseByEntity.has(entity.id)) {
            entity.applyAuthoritySimMode(PhysicsSimMode.PendingReleaseDynamic);
            return;
        }

        entity.applyAuthoritySimMode(PhysicsSimMode.AuthoritativeDynamic);
    }

    private clearPendingRelease(entityId: string): void {
        this.pendingReleaseByEntity.delete(entityId);
    }

    private refreshLocalAuthorityState(entity: PhysicsPropEntity): ILocalAuthorityState | null {
        const localId = this.context.localPlayer?.id || 'local';
        const shouldTrack =
            !this.context.isHost &&
            entity.isAuthority &&
            entity.ownerId === localId &&
            entity.getSimMode() !== PhysicsSimMode.HeldKinematic;

        if (!shouldTrack) {
            this.localAuthorityByEntity.delete(entity.id);
            return null;
        }

        let state = this.localAuthorityByEntity.get(entity.id) ?? null;
        if (!state) {
            state = {
                acquiredAtMs: this.nowMs(),
                observedAwake: !entity.rigidBody.isSleeping()
            };
            this.localAuthorityByEntity.set(entity.id, state);
            return state;
        }

        if (!entity.rigidBody.isSleeping()) {
            state.observedAwake = true;
        }

        return state;
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
