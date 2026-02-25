import RAPIER from '@dimforge/rapier3d-compat';
import { NetworkEntity } from './NetworkEntity';
import { IInteractable } from '../interfaces/IInteractable';
import { IGrabbable } from '../interfaces/IGrabbable';
import { IInteractionEvent } from '../interfaces/IInteractionEvent';
import { IView } from '../interfaces/IView';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { PhysicsPropView, IPhysicsPropState } from '../views/PhysicsPropView';
import { IPhysicsEntityState, EntityType } from '../interfaces/IEntityState';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

/**
 * Source of Truth: This entity owns the logic and physical state of a prop.
 * Visuals (PhysicsPropView) follow this state via interpolation.
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

        this.ownerId = null;
        this.syncAuthority();

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

    public updateGrabbedPose(position: IVector3, quaternion: IQuaternion): void {
        this.targetPos = { ...position };
        this.targetRot = { ...quaternion };

        if (this.rigidBody) {
            this.rigidBody.setNextKinematicTranslation(position);
            this.rigidBody.setNextKinematicRotation(quaternion);
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
        }
    }

    public update(delta: number, _frame?: XRFrame): void {
        if (!this.rigidBody) return;

        this.syncAuthority();

        if (this.isAuthority) {
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



            if (!this.heldBy && this.ownerId !== null && !this.context.isHost && this.rigidBody.isSleeping()) {
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
            // Non-authoritative: follow the physics or network target
            const position = this.rigidBody.translation();
            const rotation = this.rigidBody.rotation();

            if (this.rigidBody.bodyType() === RAPIER.RigidBodyType.Dynamic) {
                const dsq = Math.pow(this.targetPos.x - position.x, 2) +
                    Math.pow(this.targetPos.y - position.y, 2) +
                    Math.pow(this.targetPos.z - position.z, 2);

                if (dsq > 0.01) {
                    this.rigidBody.setTranslation(this.targetPos, false);
                    this.rigidBody.setRotation(this.targetRot, false);
                }

                if (this.view) {
                    this.view.applyState({
                        position: { x: position.x, y: position.y, z: position.z },
                        quaternion: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
                        lerpFactor: 1.0
                    }, delta);
                }
            } else {
                if (this.view) {
                    this.view.applyState({
                        position: this.targetPos,
                        quaternion: this.targetRot,
                        lerpFactor: this.lerpFactor
                    }, delta);
                }
            }
        }
    }

    public getNetworkState(): IPhysicsEntityState {
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

        if (stateTransition || hugeJump) {
            if (this.view) {
                this.view.applyState({
                    position: this.targetPos,
                    quaternion: this.targetRot,
                    lerpFactor: 1.0
                }, 0);
            }
        }

        if (this.rigidBody) {
            if (this.heldBy && !wasHeld) {
                this.rigidBody.wakeUp();
                this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
            } else if (!this.heldBy && wasHeld) {
                this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
                this.rigidBody.wakeUp();
            }

            if (this.heldBy) {
                this.rigidBody.setNextKinematicTranslation({ x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z });
                this.rigidBody.setNextKinematicRotation({ x: this.targetRot.x, y: this.targetRot.y, z: this.targetRot.z, w: this.targetRot.w });
            }
        }

        if (!this.heldBy && wasHeld && state.v) {
            this.rigidBody?.setLinvel({ x: state.v[0], y: state.v[1], z: state.v[2] }, true);
        }
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

