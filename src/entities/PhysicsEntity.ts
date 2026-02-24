import RAPIER from '@dimforge/rapier3d-compat';
import { NetworkEntity } from './NetworkEntity';
import { IInteractable } from '../interfaces/IInteractable';
import { IView } from '../interfaces/IView';
import { Vector3, Quaternion } from '../interfaces/IMath';
import gameState from '../core/GameState';
import { PACKET_TYPES } from '../utils/Constants';

export interface PhysicsState {
    p: [number, number, number];
    r: [number, number, number, number];
    v: [number, number, number];
    h: string | null;
    o: string | null;
}

export class PhysicsEntity extends NetworkEntity implements IInteractable {
    public rigidBody: RAPIER.RigidBody;
    public view: IView<any> | null;
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

    public handleAuthorityChange(newOwnerId: string | null): void {
        const wasAuthority = this.isAuthority;
        this.ownerId = newOwnerId;
        this.syncAuthority();

        const isAuthorityNow = this.isAuthority;

        if (wasAuthority !== isAuthorityNow && this.rigidBody) {
            const pos = this.rigidBody.translation();
            const rot = this.rigidBody.rotation();

            if (!isAuthorityNow) {
                this.targetPos = { x: pos.x, y: pos.y, z: pos.z };
                this.targetRot = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
            }
            
            // Visual snap via view
            if (this.view) {
                this.view.applyState({
                    position: { x: pos.x, y: pos.y, z: pos.z },
                    quaternion: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
                    lerpFactor: 1.0
                }, 0);
            }
        }
    }

    public syncAuthority(): void {
        const localId = (gameState as any).localPlayer?.id || 'local';
        const shouldBeAuthority = (this.ownerId === localId) || (this.ownerId === null && (gameState as any).isHost);

        if (this.isAuthority !== shouldBeAuthority) {
            console.log(`[PhysicsEntity] ${this.id} authority changing: ${this.isAuthority} -> ${shouldBeAuthority}`);
            this.onAuthorityChanged(shouldBeAuthority);
        }
    }

    public requestOwnership(): void {
        if (this.isAuthority && this.ownerId) return;
        this.handleAuthorityChange((gameState as any).localPlayer?.id || 'local');

        if (this.rigidBody) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        }

        const networkManager = (gameState as any).managers.network;
        if (networkManager && !(gameState as any).isHost) {
            networkManager.sendData((gameState as any).roomId, PACKET_TYPES.OWNERSHIP_REQUEST, { id: this.id });
        }
    }

    public releaseOwnership(velocity?: Vector3): void {
        if (!this.isAuthority) return;
        this.handleAuthorityChange(null);

        if (this.rigidBody) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            if (velocity && (Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1 || Math.abs(velocity.z) > 0.1)) {
                this.rigidBody.wakeUp();
                this.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
            }
        }

        const networkManager = (gameState as any).managers.network;
        if (networkManager) {
            const state = this.getNetworkState();
            networkManager.sendData((gameState as any).roomId, PACKET_TYPES.OWNERSHIP_RELEASE, {
                id: this.id,
                v: velocity ? [velocity.x, velocity.y, velocity.z] : [0, 0, 0],
                p: state.p,
                r: state.r
            });
        }
    }

    // IInteractable implementation
    public onHoverEnter(playerId: string): void {
        this.setHighlight(true);
    }

    public onHoverExit(playerId: string): void {
        this.setHighlight(false);
    }

    public onGrab(playerId: string): void {
        if (!this.rigidBody) return;
        
        // Ensure we have authority before changing state
        this.requestOwnership();
        
        this.heldBy = playerId;
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    public onRelease(velocity?: Vector3): void {
        if (!this.rigidBody) return;
        this.heldBy = null;
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.rigidBody.wakeUp();
        if (velocity) {
            this.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
        }
    }

    public onPrimaryAction(playerId: string): void {
        // Default: none
    }

    public setHighlight(on: boolean): void {
        if (this.view) {
            this.view.setHighlight(on);
        }
    }

    public update(delta: number, _frame?: XRFrame): void {
        if (!this.rigidBody) return;

        this.syncAuthority();

        if (this.isAuthority) {
            const position = this.rigidBody.translation();
            const rotation = this.rigidBody.rotation();

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

            if (!this.heldBy && this.ownerId !== null && !(gameState as any).isHost && this.rigidBody.isSleeping()) {
                this.releaseOwnership();
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
            // View interpolation
            if (this.view) {
                this.view.applyState({
                    position: this.targetPos,
                    quaternion: this.targetRot,
                    lerpFactor: this.lerpFactor
                }, delta);
            }

            if (this.rigidBody.bodyType() === RAPIER.RigidBodyType.Dynamic) {
                const bodyPos = this.rigidBody.translation();
                const dsq = Math.pow(this.targetPos.x - bodyPos.x, 2) + 
                            Math.pow(this.targetPos.y - bodyPos.y, 2) + 
                            Math.pow(this.targetPos.z - bodyPos.z, 2);

                if (dsq > 0.0001) {
                    this.rigidBody.setTranslation({ x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z }, false);
                    this.rigidBody.setRotation({ x: this.targetRot.x, y: this.targetRot.y, z: this.targetRot.z, w: this.targetRot.w }, false);
                } else if (!this.rigidBody.isSleeping()) {
                    const linvel = this.rigidBody.linvel();
                    if (Math.abs(linvel.x) < 0.02 && Math.abs(linvel.y) < 0.02 && Math.abs(linvel.z) < 0.02) {
                        this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                        this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                        this.rigidBody.sleep();
                    }
                }
            }
        }
    }

    public getNetworkState(): PhysicsState {
        const pos = this.rigidBody.translation();
        const rot = this.rigidBody.rotation();
        const vel = this.rigidBody.linvel();

        return {
            p: [pos.x, pos.y, pos.z],
            r: [rot.x, rot.y, rot.z, rot.w],
            v: [vel.x, vel.y, vel.z],
            h: this.heldBy,
            o: this.ownerId
        };
    }

    public applyNetworkState(state: PhysicsState): void {
        if (this.isAuthority) return;

        const wasHeld = this.heldBy;
        const oldOwner = this.ownerId;
        this.heldBy = state.h || null;

        if (state.o !== undefined && state.o !== oldOwner) {
            this.handleAuthorityChange(state.o);
        }

        const oldTargetPos = { ...this.targetPos };
        this.targetPos = { x: state.p[0], y: state.p[1], z: state.p[2] };
        this.targetRot = { x: state.r[0], y: state.r[1], z: state.r[2], w: state.r[3] };

        const stateTransition = (this.heldBy !== wasHeld) || (this.ownerId !== oldOwner);
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

        if (this.heldBy && !wasHeld) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        } else if (!this.heldBy && wasHeld) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            this.rigidBody.wakeUp();
        }

        if (!this.heldBy && wasHeld && state.v) {
            this.rigidBody.setLinvel({ x: state.v[0], y: state.v[1], z: state.v[2] }, true);
        }

        if (this.heldBy) {
            this.rigidBody.setNextKinematicTranslation({ x: state.p[0], y: state.p[1], z: state.p[2] });
            this.rigidBody.setNextKinematicRotation({ x: state.r[0], y: state.r[1], z: state.r[2], w: state.r[3] });
        }
    }
}
