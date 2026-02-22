// views/SpectatorView.js

import * as THREE from 'three';
import { EntityView } from './EntityView.js';

/**
 * Glowing orb visual for the dedicated host spectator.
 * Renders a translucent sphere with a spinning halo ring
 * and a "HOST" name tag.
 *
 * State contract (passed to update()):
 *   position   - THREE.Vector3  world position
 *   lerpFactor - number         interpolation weight (1.0 = snap)
 */
export class SpectatorView extends EntityView {
    constructor() {
        super();
        this.ring = null;
        this._buildGeometry();
    }

    _buildGeometry() {
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
    }

    update(state, delta) {
        if (!this.mesh) return;

        // Position
        if (state.position) {
            const lerpFactor = state.lerpFactor ?? 1.0;
            if (lerpFactor < 1.0) {
                this.mesh.position.lerp(state.position, lerpFactor);
            } else {
                this.mesh.position.copy(state.position);
            }
        }

        // Spin the ring
        if (this.ring) {
            this.ring.rotation.x += delta * 1.5;
            this.ring.rotation.y += delta * 0.8;
        }
    }

    destroy() {
        if (!this.mesh) return;
        this.mesh.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
    }
}
