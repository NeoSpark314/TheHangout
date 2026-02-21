import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { NetworkEntity } from './NetworkEntity.js';

export class PhysicsEntity extends NetworkEntity {
    constructor(id, isAuthority, mesh, rigidBody, options = {}) {
        super(id, 'PHYSICS_PROP', isAuthority);
        this.mesh = mesh;
        this.rigidBody = rigidBody;

        // Grabbable properties
        this.grabbable = options.grabbable || false;
        this.spawnPosition = options.spawnPosition
            ? new THREE.Vector3().copy(options.spawnPosition)
            : null;
        this.heldBy = null; // player ID of holder, or null

        // Store original emissive for highlight restoration
        if (this.mesh && this.mesh.material) {
            this._originalEmissive = this.mesh.material.emissive
                ? this.mesh.material.emissive.clone()
                : new THREE.Color(0x000000);
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
        if (velocity) {
            this.rigidBody.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
        }
        // Wake the body so physics sim picks it up
        this.rigidBody.wakeUp();
    }

    /**
     * Set a highlight on this entity (for grab proximity feedback).
     */
    setHighlight(on) {
        if (!this.mesh || !this.mesh.material || !this.mesh.material.emissive) return;
        if (on) {
            this.mesh.material.emissive.set(0xffffff);
            this.mesh.material.emissiveIntensity = 0.5;
        } else {
            this.mesh.material.emissive.copy(this._originalEmissive);
            this.mesh.material.emissiveIntensity = 1.0;
        }
    }

    update(delta) {
        if (this.rigidBody && this.mesh) {
            const position = this.rigidBody.translation();
            const rotation = this.rigidBody.rotation();

            this.mesh.position.set(position.x, position.y, position.z);
            this.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

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
            h: this.heldBy
        };
    }

    setNetworkState(state) {
        if (!this.rigidBody || !this.mesh) return;

        this.heldBy = state.h || null;

        // Snap the visual mesh
        this.mesh.position.set(state.p[0], state.p[1], state.p[2]);
        this.mesh.quaternion.set(state.r[0], state.r[1], state.r[2], state.r[3]);

        // Snap the local rigid body
        this.rigidBody.setTranslation({ x: state.p[0], y: state.p[1], z: state.p[2] }, true);
        this.rigidBody.setRotation({ x: state.r[0], y: state.r[1], z: state.r[2], w: state.r[3] }, true);

        // Apply velocity if not held (so thrown objects continue moving on remote)
        if (!this.heldBy && state.v) {
            this.rigidBody.setLinvel({ x: state.v[0], y: state.v[1], z: state.v[2] }, true);
        }
    }
}
