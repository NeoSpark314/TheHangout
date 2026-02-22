import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { NetworkEntity } from './NetworkEntity.js';
import gameState from '../core/GameState.js';
import { PACKET_TYPES } from '../utils/Constants.js';

export class PhysicsEntity extends NetworkEntity {
    /**
     * @param {string} id
     * @param {boolean} isAuthority
     * @param {THREE.Mesh} mesh
     * @param {RAPIER.RigidBody} rigidBody
     * @param {Object} [options]
     * @param {boolean} [options.grabbable]
     * @param {THREE.Vector3} [options.spawnPosition]
     * @param {import('../views/EntityView.js').EntityView} [options.view] - Optional pluggable visual
     */
    constructor(id, isAuthority, mesh, rigidBody, options = {}) {
        super(id, 'PHYSICS_PROP', isAuthority);
        this.mesh = mesh;
        this.rigidBody = rigidBody;

        // Optional view for visual effects (highlights, etc.)
        this.view = options.view || null;

        // Grabbable properties
        this.grabbable = options.grabbable || false;
        this.spawnPosition = options.spawnPosition
            ? new THREE.Vector3().copy(options.spawnPosition)
            : null;
        this.heldBy = null; // player ID of holder, or null

        // --- Optimized Sync State ---
        this.ownerId = null; // null = host (default)
        this.targetPos = new THREE.Vector3();
        this.targetRot = new THREE.Quaternion();

        // Initialize targets from rigid body if it exists to prevent snapping to (0,0,0)
        if (this.rigidBody) {
            const pos = this.rigidBody.translation();
            const rot = this.rigidBody.rotation();
            this.targetPos.set(pos.x, pos.y, pos.z);
            this.targetRot.set(rot.x, rot.y, rot.z, rot.w);
        }

        this.lerpFactor = 0.2; // Smoothing Factor
        this._vCheck = new THREE.Vector3(); // Reuse for distance checks

        // Initial authority sync
        this.syncAuthority();
    }

    /**
     * Reconcile authority and transition states.
     * Snaps mesh/targets to prevent lerp sweeps during handoff.
     */
    handleAuthorityChange(newOwnerId) {
        const wasAuthority = this.isAuthority;
        this.ownerId = newOwnerId;
        this.syncAuthority(); // Updates this.isAuthority

        const isAuthorityNow = this.isAuthority;

        // --- Discontinuity Snapping ---
        // Whenever authority flips, snap targets/mesh to prevent the lerp 
        // from sweeping through the "stale past" while waiting for network truth.
        if (wasAuthority !== isAuthorityNow && this.rigidBody) {
            const pos = this.rigidBody.translation();
            const rot = this.rigidBody.rotation();

            // Losing: Snap current physics state to network targets
            if (!isAuthorityNow) {
                this.targetPos.set(pos.x, pos.y, pos.z);
                this.targetRot.set(rot.x, rot.y, rot.z, rot.w);
            }

            // Ensure visual mesh snaps to ground truth immediately
            this.mesh.position.set(pos.x, pos.y, pos.z);
            this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
        }
    }

    /**
     * Determines if this client should be the authority based on host status and ownership.
     */
    syncAuthority() {
        const localId = gameState.localPlayer?.id || 'local';

        // We are authority if:
        // 1. We specifically own it (optimistically or confirmed)
        // 2. NOBODY owns it and we are the host
        const shouldBeAuthority = (this.ownerId === localId) || (this.ownerId === null && gameState.isHost);

        if (this.isAuthority !== shouldBeAuthority) {
            console.log(`[PhysicsEntity] ${this.id} authority changing: ${this.isAuthority} -> ${shouldBeAuthority} (owner: ${this.ownerId})`);
            this.isAuthority = shouldBeAuthority;
        }
    }

    /**
     * Optimistically take ownership and notify host
     */
    requestOwnership() {
        if (this.isAuthority && this.ownerId) return; // Already own it

        console.log(`[PhysicsEntity] Requesting ownership of ${this.id}`);
        this.handleAuthorityChange(gameState.localPlayer?.id || 'local');

        // Switch to kinematic for local control
        if (this.rigidBody) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        }

        // Notify host via NetworkManager
        if (gameState.managers.network && !gameState.isHost) {
            gameState.managers.network.sendData(gameState.roomId, PACKET_TYPES.OWNERSHIP_REQUEST, { id: this.id });
        }
    }

    /**
     * Release ownership and return to host control
     */
    releaseOwnership(velocity) {
        if (!this.isAuthority) return;

        console.log(`[PhysicsEntity] Releasing ownership of ${this.id}`);
        this.handleAuthorityChange(null);

        if (this.rigidBody) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            // Only wake it if we actually have velocity (a throw)
            // Otherwise if it's already sleeping (Handoff to Sleep), let it stay asleep.
            if (velocity && (Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1 || Math.abs(velocity.z) > 0.1)) {
                this.rigidBody.wakeUp();
                this.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
            }
        }

        // Notify host
        if (gameState.managers.network) {
            const state = this.getNetworkState();
            gameState.managers.network.sendData(gameState.roomId, PACKET_TYPES.OWNERSHIP_RELEASE, {
                id: this.id,
                v: velocity ? [velocity.x, velocity.y, velocity.z] : [0, 0, 0],
                p: state.p,
                r: state.r
            });
        }
    }

    /**
     * Grab this entity — switch to kinematic so it follows a hand.
     * @param {string} playerId - ID of the grabbing player
     */
    grab(playerId) {
        if (!this.rigidBody) return;
        this.heldBy = playerId;
        this.isAuthority = true;
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        // Zero out velocities
        this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    /**
     * Release this entity — switch back to dynamic and apply throw velocity.
     * @param {THREE.Vector3} velocity - Linear velocity to apply
     */
    release(velocity) {
        if (!this.rigidBody) return;
        this.heldBy = null;
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.rigidBody.wakeUp();
        if (velocity) {
            this.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
        }
    }

    /**
     * Set a highlight on this entity (for grab proximity feedback).
     * Delegates to the view if one is attached.
     */
    setHighlight(on) {
        if (this.view?.setHighlight) {
            this.view.setHighlight(on);
        }
    }

    update(delta) {
        if (!this.rigidBody || !this.mesh) return;

        // Ensure authority is synced (handles initial host detection and ownership changes)
        this.syncAuthority();

        if (this.isAuthority) {
            // Authoritative: Drive mesh from physics
            const position = this.rigidBody.translation();
            const rotation = this.rigidBody.rotation();

            this.mesh.position.set(position.x, position.y, position.z);
            this.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

            // Authoritative SLEEP helper: 
            // If the object is moving extremely slowly, force it to sleep to stop micro-jitter.
            if (!this.heldBy && !this.rigidBody.isSleeping()) {
                const vel = this.rigidBody.linvel();
                const angvel = this.rigidBody.angvel();
                // If velocity is very low, force it to sleep
                if (Math.abs(vel.x) < 0.02 && Math.abs(vel.y) < 0.02 && Math.abs(vel.z) < 0.02 &&
                    Math.abs(angvel.x) < 0.02 && Math.abs(angvel.y) < 0.02 && Math.abs(angvel.z) < 0.02) {
                    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                    this.rigidBody.sleep();
                }
            }

            // Handoff to Sleep Architecture:
            // If we are a GUEST and we own this object (from a throw), 
            // and it has now settled/slept, return authority to the host.
            if (!this.heldBy && this.ownerId !== null && !gameState.isHost && this.rigidBody.isSleeping()) {
                this.releaseOwnership();
            }

            // Respawn check — only if not held and below the kill plane
            if (this.grabbable && !this.heldBy && this.spawnPosition && position.y < -10) {
                this.rigidBody.setTranslation(
                    { x: this.spawnPosition.x, y: this.spawnPosition.y, z: this.spawnPosition.z },
                    true
                );
                this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                this.rigidBody.wakeUp();
            }
        } else {
            // Non-authoritative: Interpolate visuals toward target state
            const distSq = this.mesh.position.distanceToSquared(this.targetPos);
            const angleDiff = this.mesh.quaternion.angleTo(this.targetRot);

            // Only lerp if we are above a "settle" threshold to prevent micro-jitter
            if (distSq > 0.00001) {
                this.mesh.position.lerp(this.targetPos, this.lerpFactor);
            } else {
                this.mesh.position.copy(this.targetPos);
            }

            if (angleDiff > 0.001) {
                this.mesh.quaternion.slerp(this.targetRot, this.lerpFactor);
            } else {
                this.mesh.quaternion.copy(this.targetRot);
            }

            // Keep physics body synced to GROUND TRUTH (targetPos), not the visual trail (mesh)
            if (this.rigidBody.bodyType() === RAPIER.RigidBodyType.Dynamic) {
                const bodyPos = this.rigidBody.translation();
                this._vCheck.set(bodyPos.x, bodyPos.y, bodyPos.z);
                const dsq = this.targetPos.distanceToSquared(this._vCheck);

                // ONLY snap physics if the body has drifted significantly from ground truth
                if (dsq > 0.0001) { // (0.01^2)
                    this.rigidBody.setTranslation({ x: this.targetPos.x, y: this.targetPos.y, z: this.targetPos.z }, false);
                    this.rigidBody.setRotation({ x: this.targetRot.x, y: this.targetRot.y, z: this.targetRot.z, w: this.targetRot.w }, false);
                } else if (!this.rigidBody.isSleeping()) {
                    // If we are very close to target and moving slowly, force it to stop and sleep
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
    getNetworkState() {
        if (!this.rigidBody) return null;

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

    setNetworkState(state) {
        if (!this.rigidBody || !this.mesh) return;

        // If we are currently the authority, ignore incoming state updates for this entity
        // (This happens while our ownership request is in flight or relaying)
        if (this.isAuthority) return;

        const wasHeld = this.heldBy;
        const oldOwner = this.ownerId;
        this.heldBy = state.h || null;

        // Sync ownership tracking
        if (state.o !== undefined && state.o !== oldOwner) {
            this.handleAuthorityChange(state.o);
        }

        // Sync target for interpolation
        const oldTargetPos = this.targetPos.clone();
        this.targetPos.set(state.p[0], state.p[1], state.p[2]);
        this.targetRot.set(state.r[0], state.r[1], state.r[2], state.r[3]);

        // --- DISCONTINUITY SNAPPING ---
        // If the holder changed, or ownership shifted, or the object jumped a huge distance,
        // snap the visual mesh immediately. This prevents the lerp (smoothing) from 
        // creating a "pullback" or "sweep" effect during handoff.
        const stateTransition = (this.heldBy !== wasHeld) || (this.ownerId !== oldOwner);
        const hugeJump = this.targetPos.distanceToSquared(oldTargetPos) > 1.0; // >1m

        if (stateTransition || hugeJump) {
            this.mesh.position.copy(this.targetPos);
            this.mesh.quaternion.copy(this.targetRot);
        }

        // Toggle body type based on held status
        if (this.heldBy && !wasHeld) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        } else if (!this.heldBy && wasHeld) {
            this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
            this.rigidBody.wakeUp();
        }

        // Apply velocity on release so thrown objects continue moving on remote
        if (!this.heldBy && wasHeld && state.v) {
            this.rigidBody.setLinvel({ x: state.v[0], y: state.v[1], z: state.v[2] }, true);
        }

        // If it's a kinematic object (held), snap physics body to follow the host's target
        if (this.heldBy) {
            this.rigidBody.setNextKinematicTranslation({ x: state.p[0], y: state.p[1], z: state.p[2] });
            this.rigidBody.setNextKinematicRotation({ x: state.r[0], y: state.r[1], z: state.r[2], w: state.r[3] });
        }
    }
}
