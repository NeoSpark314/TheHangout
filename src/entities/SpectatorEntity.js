// entities/SpectatorEntity.js

import * as THREE from 'three';
import { NetworkEntity } from './NetworkEntity.js';
import gameState from '../core/GameState.js';

/**
 * Dedicated Host spectator entity.
 *
 * Follows the Unified Entity Pattern (see NetworkEntity.js):
 *   Authority  (host)  → free-fly camera controls, broadcasts position
 *   Non-Auth   (guest) → receives position, view lerps orb smoothly
 *
 * Rendering delegated to this.view (typically SpectatorView).
 */
export class SpectatorEntity extends NetworkEntity {
    /**
     * @param {string} id
     * @param {boolean} isAuthority
     * @param {import('../views/EntityView.js').EntityView} view - Pluggable visual
     */
    constructor(id, isAuthority = false, view) {
        super(id, 'SPECTATOR', isAuthority);

        this.view = view;
        this.mesh = view?.mesh ?? null;

        // Non-authority interpolation target
        this.targetPosition = new THREE.Vector3(0, 8, 10);

        // Authority-only: camera control state
        if (this.isAuthority) {
            this.moveSpeed = 8;
            this.lookSpeed = 0.002;
            this.pitch = 0;
            this.yaw = 0;
            this.isPointerLocked = false;
            this.initControls();
        }

        if (this.mesh) {
            this.mesh.position.copy(this.targetPosition);
        }
    }

    // ─── Authority-only: camera controls ─────────────────────────────

    initControls() {
        const { render } = gameState.managers;
        if (!render) return;

        const canvas = render.renderer.domElement;

        canvas.addEventListener('click', () => {
            if (!this.isPointerLocked) {
                canvas.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === canvas;
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isPointerLocked) return;
            this.yaw -= e.movementX * this.lookSpeed;
            this.pitch -= e.movementY * this.lookSpeed;
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
        });
    }

    // ─── Update (branches on authority) ──────────────────────────────

    update(delta) {
        if (this.isAuthority) {
            this.updateAuthority(delta);
        } else {
            this.updateRemote(delta);
        }

        // Let the view handle its own animations (ring spin, etc.)
        if (this.view) {
            const position = this.mesh ? this.mesh.position : this.targetPosition;
            this.view.update({
                position: position,
                lerpFactor: 1.0
            }, delta);
        }
    }

    /** Authority: drive camera, sync orb position to camera. */
    updateAuthority(delta) {
        const { render, input } = gameState.managers;
        if (!render || !input) return;

        const moveVec = input.getMovementVector();

        const forward = new THREE.Vector3(
            -Math.sin(this.yaw), 0, -Math.cos(this.yaw)
        );
        const right = new THREE.Vector3(
            Math.cos(this.yaw), 0, -Math.sin(this.yaw)
        );

        const velocity = new THREE.Vector3();
        velocity.addScaledVector(forward, -moveVec.y * this.moveSpeed * delta);
        velocity.addScaledVector(right, moveVec.x * this.moveSpeed * delta);

        if (input.keyboard.e) velocity.y += this.moveSpeed * delta;
        if (input.keyboard.q) velocity.y -= this.moveSpeed * delta;

        render.cameraGroup.position.add(velocity);
        render.cameraGroup.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // Sync orb to camera world position
        if (this.mesh) {
            const camWorldPos = new THREE.Vector3();
            render.camera.getWorldPosition(camWorldPos);
            this.mesh.position.copy(camWorldPos);
        }
    }

    /** Non-authority: lerp orb toward received target position. */
    updateRemote(delta) {
        if (!this.mesh) return;
        this.mesh.position.lerp(this.targetPosition, 8 * delta);
    }

    // ─── Network (Unified Entity Pattern) ────────────────────────────

    getNetworkState() {
        if (!this.mesh) return null;
        return {
            p: [this.mesh.position.x, this.mesh.position.y, this.mesh.position.z],
            name: 'Host'
        };
    }

    setNetworkState(state) {
        if (state.p) {
            this.targetPosition.set(state.p[0], state.p[1], state.p[2]);
        }
        if (state.name) {
            this.name = state.name;
        }
    }

    // ─── Cleanup ─────────────────────────────────────────────────────

    destroy() {
        super.destroy();

        const { render } = gameState.managers;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }

        if (this.isAuthority && document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
}
