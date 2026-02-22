// entities/SpectatorEntity.js
import * as THREE from 'three';
import { NetworkEntity } from './NetworkEntity.js';
import gameState from '../core/GameState.js';

/**
 * A lightweight entity for the Dedicated Host.
 * No avatar — just a free-fly spectator camera.
 * Does not broadcast any player state to guests.
 */
export class SpectatorEntity extends NetworkEntity {
    constructor(id) {
        super(id, 'SPECTATOR', false); // Not authoritative — nothing to broadcast

        this.moveSpeed = 8;
        this.lookSpeed = 0.002;
        this.pitch = -0.4; // Slight downward look
        this.yaw = 0;
        this.isPointerLocked = false;

        this.initControls();
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

        // Position camera at a good overview point
        render.cameraGroup.position.set(0, 8, 10);
        this.yaw = Math.PI; // Face toward center
        this.pitch = -0.4;
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

        // Apply movement
        const velocity = new THREE.Vector3();
        velocity.addScaledVector(forward, -moveVec.y * this.moveSpeed * delta);
        velocity.addScaledVector(right, moveVec.x * this.moveSpeed * delta);

        render.cameraGroup.position.add(velocity);

        // Apply rotation
        render.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }

    getNetworkState() {
        return null; // Spectator is invisible — nothing to broadcast
    }

    setNetworkState(state) {
        // Spectator doesn't receive state
    }

    destroy() {
        super.destroy();
        // Pointer lock cleanup happens automatically
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    }
}
