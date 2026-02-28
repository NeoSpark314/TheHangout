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
 * Visuals (PhysicsPropView) follow this state via interpolation.
 *
 * Ownership / simulation model:
 * - Authoritative instance simulates real dynamics (Dynamic body when free, Kinematic when held).
 * - Non-authoritative instance acts as a kinematic network proxy (no local dynamics) and
 *   only interpolates visuals to remote snapshots.
 * - On guest release we keep temporary local authority (`pendingRelease`) until host ACK
 *   (`OWNERSHIP_TRANSFER`) to avoid throw discontinuities at handoff time.
 *
 * Why this exists:
 * - Immediate guest authority drop causes "throw dies on release" artifacts.
 * - Teleport-correcting non-authoritative dynamic bodies causes jitter and sleep churn.
 * - Explicit proxy mode keeps behavior deterministic across host/guest roles.
 */
export class PhysicsEntity extends NetworkEntity implements IInteractable, IGrabbable {
    public rigidBody: RAPIER.RigidBody;
    public view: IView<IPhysicsPropState> | null;
    public isGrabbable: boolean;
    public spawnPosition: IVector3 | null;
    public heldBy: string | null = null;

    private targetPos: IVector3 = { x: 0, y: 0, z: 0 };
    private targetRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private lerpFactor: number = 0.2;
    // True after a guest release until host transfer ACK confirms authority handoff.
    private pendingRelease: boolean = false;
    // Visual-only smoothing state for non-authoritative proxy rendering.
    private proxyRenderPos: IVector3 = { x: 0, y: 0, z: 0 };
    private proxyRenderRot: IQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    private proxyInitialized: boolean = false;

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

        this.syncAuthority();
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

        if (this.rigidBody) {
            this.rigidBody.wakeUp();
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            if (velocity && (Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1 || Math.abs(velocity.z) > 0.1)) {
                this.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
            }
        }

        // Keep guest-side authority until host transfer ACK arrives so release/throw remains continuous.
        const localId = this.context.localPlayer?.id || 'local';
        if (this.context.isHost) {
            this.ownerId = null;
            this.syncAuthority();
        } else {
            this.pendingRelease = true;
            this.ownerId = localId;
            this.isAuthority = true;
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
        this.rigidBody.wakeUp();
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
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
        this.proxyInitialized = true;

        if (this.rigidBody) {
            this.rigidBody.setNextKinematicTranslation(pose.position);
            this.rigidBody.setNextKinematicRotation(pose.quaternion);
        }
    }

    public onNetworkEvent(type: string, payload: any): void {
        if (type === 'OWNERSHIP_RELEASE' && this.rigidBody) {
            this.heldBy = null; // Reset held status locally
            // Restore Dynamic physics locally
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

            if (payload.position) this.rigidBody.setTranslation({ x: payload.position[0], y: payload.position[1], z: payload.position[2] }, false);
            if (payload.quaternion) this.rigidBody.setRotation({ x: payload.quaternion[0], y: payload.quaternion[1], z: payload.quaternion[2], w: payload.quaternion[3] }, false);
            if (payload.velocity) {
                this.rigidBody.setLinvel({ x: payload.velocity[0], y: payload.velocity[1], z: payload.velocity[2] }, true);
            }

            this.rigidBody.wakeUp();
        } else if (type === 'OWNERSHIP_TRANSFER') {
            const newOwnerId = payload?.newOwnerId ?? null;
            const localId = this.context.localPlayer?.id || 'local';

            // Host ACK finished release handoff; we can now safely stop local authoritative sim.
            if (this.pendingRelease && newOwnerId !== localId) {
                this.pendingRelease = false;
            }
        }
    }

    public update(delta: number, _frame?: XRFrame): void {
        if (!this.rigidBody) return;

        this.syncAuthority();

        if (this.isAuthority) {
            if (this.heldBy) {
                if (this.rigidBody.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
                    this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
                    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                }
            } else if (this.rigidBody.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
                this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
                this.rigidBody.wakeUp();
            }

            const position = this.rigidBody.translation();
            const rotation = this.rigidBody.rotation();

            // If we are holding it, apply target transforms
            if (this.heldBy && this.rigidBody.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased) {
                this.rigidBody.setNextKinematicTranslation(this.targetPos);
                this.rigidBody.setNextKinematicRotation(this.targetRot);
            }

            if (this.view) {
                this.view.applyState({
                    position: { x: position.x, y: position.y, z: position.z },
                    quaternion: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
                    lerpFactor: 1.0
                }, delta);
            }



            if (!this.pendingRelease && !this.heldBy && this.ownerId !== null && !this.context.isHost && this.rigidBody.isSleeping()) {
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
        } else {
            // Non-authoritative: strict kinematic proxy mode.
            // We follow network targets in physics-space for collision coherence, but smooth only visually.
            if (this.rigidBody.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
                this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
                this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }

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

            if (this.view) {
                this.view.applyState({
                    position: this.proxyRenderPos,
                    quaternion: this.proxyRenderRot,
                    lerpFactor: 1.0
                }, delta);
            }
        }
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

        // If we are currently the authority (holding it), ignore the server's outdated state
        if (this.isAuthority) return;

        const wasHeld = this.heldBy;
        this.heldBy = state.b || null;

        const oldTargetPos = { ...this.targetPos };

        if (state.p) this.targetPos = { x: state.p[0], y: state.p[1], z: state.p[2] };
        if (state.q) this.targetRot = { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] };

        const stateTransition = (this.heldBy !== wasHeld);
        const hugeJump = Math.pow(this.targetPos.x - oldTargetPos.x, 2) +
            Math.pow(this.targetPos.y - oldTargetPos.y, 2) +
            Math.pow(this.targetPos.z - oldTargetPos.z, 2) > 1.0;

        // Snap visual proxy on major discontinuities to avoid long trailing lerps after teleports/ownership flips.
        if (stateTransition || hugeJump) {
            this.proxyRenderPos = { ...this.targetPos };
            this.proxyRenderRot = { ...this.targetRot };
            this.proxyInitialized = true;
        }

        if (!this.heldBy && wasHeld && state.v) {
            this.rigidBody?.setLinvel({ x: state.v[0], y: state.v[1], z: state.v[2] }, true);
        }
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

    public destroy(): void {
        super.destroy();
        const render = this.context.managers.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}

