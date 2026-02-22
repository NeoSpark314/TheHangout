// entities/RemoteSpectator.js
import * as THREE from 'three';
import { NetworkEntity } from './NetworkEntity.js';
import gameState from '../core/GameState.js';

/**
 * A remote representation of the dedicated host's spectator orb.
 * Guests see this as a small floating indicator showing where the host is.
 */
export class RemoteSpectator extends NetworkEntity {
    constructor(id) {
        super(id, 'SPECTATOR', false);

        this.targetPosition = new THREE.Vector3(0, 8, 10);
        this.mesh = null;

        this.initVisual();
    }

    initVisual() {
        const { render } = gameState.managers;
        if (!render) return;

        // Glowing orb (matches host's visual)
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

    setNetworkState(state) {
        if (state.p) {
            this.targetPosition.set(state.p[0], state.p[1], state.p[2]);
        }
    }

    update(delta) {
        if (!this.mesh) return;

        // Smooth lerp toward target
        this.mesh.position.lerp(this.targetPosition, 8 * delta);

        // Spin the ring
        if (this.ring) {
            this.ring.rotation.x += delta * 1.5;
            this.ring.rotation.y += delta * 0.8;
        }
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
    }
}
