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

        // Create a distinct color for remote players (Neon Magenta Outline, dark solid body)
        const material = new THREE.MeshBasicMaterial({ color: 0x050510 });
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
        this.mesh = new THREE.Mesh(geometry, material);

        // Neon Magenta Outline
        const edges = new THREE.EdgesGeometry(geometry);
        const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xff00ff });
        const outline = new THREE.LineSegments(edges, outlineMaterial);
        this.mesh.add(outline);

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
