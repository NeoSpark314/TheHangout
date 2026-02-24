import RAPIER from '@dimforge/rapier3d-compat';
import { NetworkEntity } from './NetworkEntity';
import { IInteractable } from '../interfaces/IInteractable';
import { IGrabbable } from '../interfaces/IGrabbable';
import { InteractionEvent } from '../interfaces/IInteractionEvent';
import { IView } from '../interfaces/IView';
import { Vector3, Quaternion } from '../interfaces/IMath';
import { PhysicsPropView, PhysicsPropState } from '../views/PhysicsPropView';
import { PhysicsEntityState } from '../interfaces/IEntityState';
import gameState from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

/**
 * Source of Truth: This entity owns the logic and physical state of a prop.
 * Visuals (PhysicsPropView) follow this state via interpolation.
 */
export class PhysicsEntity extends NetworkEntity implements IInteractable, IGrabbable {
    public rigidBody: RAPIER.RigidBody;
    public view: IView<PhysicsPropState> | null;
    public isGrabbable: boolean;
    public spawnPosition: Vector3 | null;
    public heldBy: string | null = null;
    
    private targetPos: Vector3 = { x: 0, y: 0, z: 0 };
    private targetRot: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
    private lerpFactor: number = 0.2;

    constructor(id: string, isAuthority: boolean, rigidBody: RAPIER.RigidBody, options: any = {}) {
        super(id, 'PHYSICS_PROP', isAuthority);
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
        const localId = gameState.localPlayer?.id || 'local';
        const shouldBeAuthority = (this.ownerId === localId) || (this.ownerId === null && gameState.isHost);

        if (this.isAuthority !== shouldBeAuthority) {
            console.log(`[PhysicsEntity] ${this.id} authority changing: ${this.isAuthority} -> ${shouldBeAuthority}`);
            this.onAuthorityChanged(shouldBeAuthority);
        }
    }

    public releasePhysicsOwnership(velocity?: Vector3): void {
        if (!this.isAuthority) return;
        
        if (this.rigidBody) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            if (velocity && (Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1 || Math.abs(velocity.z) > 0.1)) {
                this.rigidBody.wakeUp();
                this.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
            }
        }

        this.ownerId = null;
        this.syncAuthority();

        const state = this.getNetworkState();
        eventBus.emit(EVENTS.RELEASE_OWNERSHIP, {
            id: this.id,
            velocity: velocity ? [velocity.x, velocity.y, velocity.z] : [0, 0, 0],
            position: state.position,
            quaternion: state.quaternion
        });
    }

    // --- IInteractable ---
    public onHoverEnter(playerId: string): void {
        if (this.view) this.view.setHighlight(true);
    }

    public onHoverExit(playerId: string): void {
        if (this.view) this.view.setHighlight(false);
    }

    public onInteraction(event: InteractionEvent): void {
        // Implementation for tool usage
    }

    // --- IGrabbable ---
    public onGrab(playerId: string, hand: 'left' | 'right'): void {
        if (!this.rigidBody) return;
        this.requestOwnership();
        
        this.heldBy = playerId;
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    public onRelease(velocity?: Vector3): void {
        if (!this.rigidBody) return;
        this.heldBy = null;
        this.releasePhysicsOwnership(velocity);
    }

    public updateGrabbedPose(position: Vector3, quaternion: Quaternion): void {
        this.targetPos = { ...position };
        this.targetRot = { ...quaternion };
        
        if (this.rigidBody) {
            this.rigidBody.setNextKinematicTranslation(position);
            this.rigidBody.setNextKinematicRotation(quaternion);
        }
    }

    public onNetworkEvent(type: string, payload: any): void {
        if (type === 'OWNERSHIP_RELEASE' && this.rigidBody) {
            // Restore Dynamic physics locally
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            
            if (payload.position) this.rigidBody.setTranslation({ x: payload.position[0], y: payload.position[1], z: payload.position[2] }, false);
            if (payload.quaternion) this.rigidBody.setRotation({ x: payload.quaternion[0], y: payload.quaternion[1], z: payload.quaternion[2], w: payload.quaternion[3] }, false);
            if (payload.velocity) {
                this.rigidBody.wakeUp();
                this.rigidBody.setLinvel({ x: payload.velocity[0], y: payload.velocity[1], z: payload.velocity[2] }, true);
            }
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

            if (!this.heldBy && !this.rigidBody.isSleeping()) {
                const vel = this.rigidBody.linvel();
                const angvel = this.rigidBody.angvel();
                if (Math.abs(vel.x) < 0.02 && Math.abs(vel.y) < 0.02 && Math.abs(vel.z) < 0.02 &&
                    Math.abs(angvel.x) < 0.02 && Math.abs(angvel.y) < 0.02 && Math.abs(angvel.z) < 0.02) {
                    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                    this.rigidBody.sleep();
                }
            }

            if (!this.heldBy && this.ownerId !== null && !gameState.isHost && this.rigidBody.isSleeping()) {
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

    public getNetworkState(): PhysicsEntityState {
        const pos = this.rigidBody.translation();
        const rot = this.rigidBody.rotation();
        const vel = this.rigidBody.linvel();

        return {
            position: [pos.x, pos.y, pos.z],
            quaternion: [rot.x, rot.y, rot.z, rot.w],
            velocity: [vel.x, vel.y, vel.z],
            heldBy: this.heldBy,
            ownerId: this.ownerId
        };
    }

    public applyNetworkState(state: PhysicsEntityState): void {
        this.syncNetworkState(state);
        
        // If we are currently the authority (holding it), ignore the server's outdated state
        if (this.isAuthority) return;

        const wasHeld = this.heldBy;
        this.heldBy = state.heldBy || null;

        const oldTargetPos = { ...this.targetPos };
        
        if (state.position) this.targetPos = { x: state.position[0], y: state.position[1], z: state.position[2] };
        if (state.quaternion) this.targetRot = { x: state.quaternion[0], y: state.quaternion[1], z: state.quaternion[2], w: state.quaternion[3] };

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

        if (!this.heldBy && wasHeld && state.velocity) {
            this.rigidBody?.setLinvel({ x: state.velocity[0], y: state.velocity[1], z: state.velocity[2] }, true);
        }
    }

    public destroy(): void {
        super.destroy();
        const render = gameState.managers.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
