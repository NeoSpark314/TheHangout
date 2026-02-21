// managers/DebugUIManager.js
import * as THREE from 'three';
import gameState from '../core/GameState.js';

export class DebugUIManager {
    constructor() {
        this.group = new THREE.Group();
        this.panel = null;
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext('2d');
        this.texture = null;

        this.initPanel();
    }

    initPanel() {
        const { render } = gameState.managers;
        if (!render) return;

        // Canvas setup for text
        this.canvas.width = 512;
        this.canvas.height = 256;

        this.texture = new THREE.CanvasTexture(this.canvas);
        const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false, // Ensure it draws over other things
            depthWrite: false
        });

        const geometry = new THREE.PlaneGeometry(0.5, 0.25);
        this.panel = new THREE.Mesh(geometry, material);

        // Position it "in front" by default
        this.panel.position.set(0, 0, -1); // Move further away to avoid clipping
        this.panel.renderOrder = 999;
        this.group.add(this.panel);
    }

    updateDebugText(text) {
        if (!this.context) return;

        // Clear canvas
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw background
        this.context.fillStyle = 'rgba(10, 4, 28, 0.8)'; // Deep retro purple
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw border
        this.context.strokeStyle = '#00ffff'; // Cyan
        this.context.lineWidth = 4;
        this.context.strokeRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw text
        this.context.fillStyle = '#00ffff';
        this.context.font = 'bold 24px monospace';
        this.context.textAlign = 'left';
        this.context.textBaseline = 'top';

        const lines = text.split('\n');
        lines.forEach((line, i) => {
            this.context.fillText(line, 20, 20 + i * 30);
        });

        this.texture.needsUpdate = true;
    }

    attachTo(parent) {
        parent.add(this.group);
    }
}
