// managers/HUDManager.js
import * as THREE from 'three';
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS } from '../utils/Constants.js';

export class HUDManager {
    constructor() {
        this.group = new THREE.Group();
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext('2d');
        this.texture = null;
        this.mesh = null;

        // Configuration
        this.canvas.width = 512;
        this.canvas.height = 512;
        this.opacity = 0.8;

        this.notifications = []; // { text, startTime, duration }
        this.maxNotifications = 3;
        this.playerNames = [];

        this.init();

        // Listen for network events
        eventBus.on(EVENTS.PEER_CONNECTED, () => this.updatePlayerList());
        eventBus.on(EVENTS.PEER_DISCONNECTED, () => this.updatePlayerList());
        eventBus.on(EVENTS.LOCAL_NAME_UPDATED, () => this.updatePlayerList());
        eventBus.on(EVENTS.REMOTE_NAME_UPDATED, (data) => {
            this.updatePlayerList();
            this.showNotification(`${data.name} joined the hangout!`);
        });

        // Initial sync
        setTimeout(() => this.updatePlayerList(), 100);
    }

    init() {
        // Create 3D Mesh
        const geometry = new THREE.PlaneGeometry(0.5, 0.5);
        this.texture = new THREE.CanvasTexture(this.canvas);
        const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            opacity: this.opacity,
            depthTest: false,
            depthWrite: false
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.renderOrder = 999;

        // Position in view (top-right-ish)
        // Note: This matches the camera's local space
        this.mesh.position.set(0.4, 0.25, -0.6);
        this.group.add(this.mesh);

        // Update the HUD initially
        this.draw();
    }

    updatePlayerList() {
        const entityMgr = gameState.managers.entity;
        if (!entityMgr) return;

        this.playerNames = [];
        // Add self
        if (gameState.playerName) {
            this.playerNames.push(`${gameState.playerName} (YOU)`);
        }

        // Add others
        const entities = entityMgr.entities;
        for (const entity of entities.values()) {
            if (entity.type === 'REMOTE_PLAYER' && entity.name) {
                this.playerNames.push(entity.name);
            }
        }

        this.draw();
    }

    showNotification(text, duration = 4000) {
        this.notifications.push({
            text: text.toUpperCase(),
            startTime: performance.now(),
            duration: duration
        });

        // Keep list manageable
        if (this.notifications.length > this.maxNotifications) {
            this.notifications.shift();
        }

        this.draw();
    }

    update() {
        // Clean up expired notifications
        const now = performance.now();
        const initialCount = this.notifications.length;
        this.notifications = this.notifications.filter(n => (now - n.startTime) < n.duration);

        if (this.notifications.length !== initialCount) {
            this.draw();
        }

        // Smoothly follow camera? 
        // For now, it's just a child of the camera group/camera itself in main.js
    }

    draw() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);

        // --- 1. Draw Player List (Top Right) ---
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        // Rounded background box
        this.drawRoundedRect(ctx, w - 210, 10, 200, 30 + (this.playerNames.length * 25), 10);
        ctx.fill();

        ctx.font = 'bold 24px Inter, Arial, sans-serif';
        ctx.fillStyle = '#00ffff'; // Cyber Cyan
        ctx.fillText('PARTICIPANTS:', w - 200, 40);

        ctx.font = '18px Inter, Arial, sans-serif';
        ctx.fillStyle = '#ffffff';
        this.playerNames.forEach((name, i) => {
            ctx.fillText(name, w - 200, 70 + (i * 25));
        });
        ctx.restore();

        // --- 2. Draw Notifications (Bottom Center) ---
        if (this.notifications.length > 0) {
            ctx.save();
            ctx.textAlign = 'center';
            this.notifications.forEach((n, i) => {
                const age = performance.now() - n.startTime;
                const opacity = Math.min(1.0, 1.0 - (age / n.duration) * 2.0); // Fade out in last half

                if (opacity > 0) {
                    ctx.fillStyle = `rgba(255, 0, 255, ${opacity * 0.8})`; // Neon Pink
                    this.drawRoundedRect(ctx, w / 2 - 200, h - 100 - (i * 50), 400, 40, 5);
                    ctx.fill();

                    ctx.font = '20px Inter, Arial, sans-serif';
                    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                    ctx.fillText(n.text, w / 2, h - 75 - (i * 50));
                }
            });
            ctx.restore();
        }

        if (this.texture) this.texture.needsUpdate = true;
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }
}
