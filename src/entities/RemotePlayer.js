// entities/RemotePlayer.js
import * as THREE from 'three';
import gameState from '../core/GameState.js';

export class RemotePlayer {
    constructor(peerId) {
        this.peerId = peerId;

        // Physical Interpolation targets
        this.targetPosition = new THREE.Vector3(0, 5, 0);
        this.targetYaw = 0;

        this.initAvatar();
    }

    initAvatar() {
        const { render } = gameState.managers;
        if (!render) return;

        // Create a distinct color for remote players (e.g. green)
        const material = new THREE.MeshStandardMaterial({ color: 0x10b981 });
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;

        // Start somewhat high up
        this.mesh.position.copy(this.targetPosition);

        render.add(this.mesh);
        console.log(`[RemotePlayer] Created avatar for ${this.peerId}`);
    }

    setTargetState(position, yaw) {
        this.targetPosition.set(position.x, position.y, position.z);
        this.targetYaw = yaw;
    }

    update(delta) {
        // Interpolate position and rotation towards target over time
        // The weight factor (e.g. 10 * delta) controls snappiness vs smoothness
        if (this.mesh) {
            this.mesh.position.lerp(this.targetPosition, 10 * delta);

            // Only rotate Y for the body representation based on yaw
            const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.targetYaw, 0, 'YXZ'));
            this.mesh.quaternion.slerp(targetQuaternion, 10 * delta);
        }
    }

    destroy() {
        const { render } = gameState.managers;
        if (render && this.mesh) {
            render.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }
}
