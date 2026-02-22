// entities/SpectatorEntity.js
import * as THREE from 'three';
import { NetworkEntity } from './NetworkEntity.js';
import gameState from '../core/GameState.js';

/**
 * Dedicated Host spectator entity.
 *
 * Follows the Unified Entity Pattern (see NetworkEntity.js):
 *   Authority  (host)  → free-fly camera controls, broadcasts position
 *   Non-Auth   (guest) → receives position, lerps orb smoothly
 *
 * Both modes share the same visual: a glowing orb with a spinning ring
 * and a "HOST" name tag.
 */
export class SpectatorEntity extends NetworkEntity {
    constructor(id, isAuthority = false) {
        super(id, 'SPECTATOR', isAuthority);

        this.mesh = null;
        this.ring = null;

        // Non-authority interpolation target
        this.targetPosition = new THREE.Vector3(0, 8, 10);

        // Authority-only: camera control state
        if (this.isAuthority) {
            this.moveSpeed = 8;
            this.lookSpeed = 0.002;
            this.pitch = 0;
            this.yaw = 0;
            this.isPointerLocked = false;
        }

        this.initVisual();

        if (this.isAuthority) {
            this.initControls();
        }
    }

    // ─── Visual (shared by both modes) ───────────────────────────────

    initVisual() {
        const { render } = gameState.managers;
        if (!render) return;

        // Glowing orb
        const geometry = new THREE.SphereGeometry(0.15, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.7
        });
        this.mesh = new THREE.Mesh(geometry, material);

        // Halo ring
        const ringGeometry = new THREE.RingGeometry(0.2, 0.25, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });
        this.ring = new THREE.Mesh(ringGeometry, ringMaterial);
        this.mesh.add(this.ring);

        // "HOST" name tag
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
        ctx.fill();

        ctx.font = 'bold 36px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ff00ff';
        ctx.fillText('HOST', canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const nameSprite = new THREE.Sprite(spriteMaterial);
        nameSprite.scale.set(0.5, 0.125, 1);
        nameSprite.position.y = 0.35;
        this.mesh.add(nameSprite);

        this.mesh.position.copy(this.targetPosition);
        render.add(this.mesh);
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

        // Shared: spin the ring
        if (this.ring) {
            this.ring.rotation.x += delta * 1.5;
            this.ring.rotation.y += delta * 0.8;
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
            p: [this.mesh.position.x, this.mesh.position.y, this.mesh.position.z]
        };
    }

    setNetworkState(state) {
        if (state.p) {
            this.targetPosition.set(state.p[0], state.p[1], state.p[2]);
        }
    }

    // ─── Cleanup ─────────────────────────────────────────────────────

    destroy() {
        super.destroy();

        const { render } = gameState.managers;
        if (render && this.mesh) {
            render.remove(this.mesh);
            this.mesh.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }

        if (this.isAuthority && document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
}
