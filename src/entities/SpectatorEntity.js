// entities/SpectatorEntity.js
import * as THREE from 'three';
import { NetworkEntity } from './NetworkEntity.js';
import gameState from '../core/GameState.js';

/**
 * A lightweight entity for the Dedicated Host.
 * Shows a small floating orb indicator and provides free-fly spectator camera.
 * Broadcasts position so guests can see where the host is.
 */
export class SpectatorEntity extends NetworkEntity {
    constructor(id) {
        super(id, 'SPECTATOR', true); // Authoritative — broadcasts position

        this.moveSpeed = 8;
        this.lookSpeed = 0.002;
        this.pitch = 0;
        this.yaw = 0;
        this.isPointerLocked = false;

        this.mesh = null;
        this.initVisual();
        this.initControls();
    }

    /**
     * Create a small floating orb as the host's visual indicator.
     */
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

        // Name tag "HOST"
        this.createNameTag();

        render.add(this.mesh);
    }

    createNameTag() {
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
        this.nameSprite = new THREE.Sprite(spriteMaterial);
        this.nameSprite.scale.set(0.5, 0.125, 1);
        this.nameSprite.position.y = 0.35;
        this.mesh.add(this.nameSprite);
    }

    initControls() {
        const { render } = gameState.managers;
        if (!render) return;

        const canvas = render.renderer.domElement;

        // Pointer lock for mouse look
        canvas.addEventListener('click', () => {
            if (!this.isPointerLocked) {
                canvas.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === canvas;
        });

        // Mouse look
        document.addEventListener('mousemove', (e) => {
            if (!this.isPointerLocked) return;
            this.yaw -= e.movementX * this.lookSpeed;
            this.pitch -= e.movementY * this.lookSpeed;
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
        });
    }

    update(delta) {
        const { render, input } = gameState.managers;
        if (!render || !input) return;

        // Get movement from InputManager (keyboard/gamepad)
        const moveVec = input.getMovementVector();

        // Build directional vectors from yaw
        const forward = new THREE.Vector3(
            -Math.sin(this.yaw),
            0,
            -Math.cos(this.yaw)
        );
        const right = new THREE.Vector3(
            Math.cos(this.yaw),
            0,
            -Math.sin(this.yaw)
        );

        // Apply movement to cameraGroup
        const velocity = new THREE.Vector3();
        velocity.addScaledVector(forward, -moveVec.y * this.moveSpeed * delta);
        velocity.addScaledVector(right, moveVec.x * this.moveSpeed * delta);
        render.cameraGroup.position.add(velocity);

        // Apply rotation to cameraGroup (not camera, to avoid compound rotations)
        render.cameraGroup.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // Update orb position to follow camera
        if (this.mesh) {
            const camWorldPos = new THREE.Vector3();
            render.camera.getWorldPosition(camWorldPos);
            this.mesh.position.copy(camWorldPos);

            // Make ring slowly spin for visual flair
            if (this.ring) {
                this.ring.rotation.x += delta * 1.5;
                this.ring.rotation.y += delta * 0.8;
            }
        }
    }

    getNetworkState() {
        if (!this.mesh) return null;

        return {
            p: [this.mesh.position.x, this.mesh.position.y, this.mesh.position.z]
        };
    }

    setNetworkState(state) {
        // Spectator doesn't receive state from others
    }

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

        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
}
