// managers/HUDManager.js
import * as THREE from 'three';
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS } from '../utils/Constants.js';

export class HUDManager {
    constructor() {
        this.group = new THREE.Group();

        // --- Panel 1: Participants (Top-Left) ---
        this.listCanvas = document.createElement('canvas');
        this.listContext = this.listCanvas.getContext('2d');
        this.listCanvas.width = 512;
        this.listCanvas.height = 512;
        this.listTexture = null;
        this.listMesh = null;

        // --- Panel 2: Notifications (Bottom-Center) ---
        this.noteCanvas = document.createElement('canvas');
        this.noteContext = this.noteCanvas.getContext('2d');
        this.noteCanvas.width = 1024; // Wider for text
        this.noteCanvas.height = 256;
        this.noteTexture = null;
        this.noteMesh = null;

        this.opacity = 0.8;
        this.notifications = []; // { text, startTime, duration }
        this.maxNotifications = 1; // Only show most recent in the new centered spot? Or stack?
        this.playerNames = [];

        this.init();

        // Listen for events
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
        // --- List Panel Mesh ---
        const listGeo = new THREE.PlaneGeometry(0.5, 0.5);
        this.listTexture = new THREE.CanvasTexture(this.listCanvas);
        const listMat = new THREE.MeshBasicMaterial({
            map: this.listTexture,
            transparent: true,
            opacity: this.opacity,
            depthTest: false,
            depthWrite: false
        });
        this.listMesh = new THREE.Mesh(listGeo, listMat);
        this.listMesh.renderOrder = 999;
        this.listMesh.position.set(-0.5, 0.25, -1.0); // Top-Left, further back for comfort
        this.group.add(this.listMesh);

        // --- Notification Panel Mesh ---
        const noteGeo = new THREE.PlaneGeometry(1.0, 0.25);
        this.noteTexture = new THREE.CanvasTexture(this.noteCanvas);
        const noteMat = new THREE.MeshBasicMaterial({
            map: this.noteTexture,
            transparent: true,
            opacity: this.opacity,
            depthTest: false,
            depthWrite: false
        });
        this.noteMesh = new THREE.Mesh(noteGeo, noteMat);
        this.noteMesh.renderOrder = 1000;
        this.noteMesh.position.set(0, -0.35, -1.0); // Bottom-Center
        this.group.add(this.noteMesh);

        this.draw();
    }

    updatePlayerList() {
        const entityMgr = gameState.managers.entity;
        if (!entityMgr) return;

        this.playerNames = [];
        if (gameState.playerName) {
            const suffix = gameState.isDedicatedHost ? '(SPECTATOR)' : '(YOU)';
            this.playerNames.push(`${gameState.isDedicatedHost ? 'Host' : gameState.playerName} ${suffix}`);
        }

        const entities = entityMgr.entities;
        for (const entity of entities.values()) {
            if (entity.type === 'REMOTE_PLAYER' && entity.name) {
                this.playerNames.push(entity.name);
            }
            if (entity.type === 'SPECTATOR' && entity.name) {
                this.playerNames.push(`👁 ${entity.name}`);
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

        if (this.notifications.length > this.maxNotifications) {
            this.notifications.shift();
        }

        this.draw();
    }

    update() {
        const now = performance.now();
        const initialCount = this.notifications.length;
        this.notifications = this.notifications.filter(n => (now - n.startTime) < n.duration);

        if (this.notifications.length !== initialCount) {
            this.draw();
        }

        // Periodically refresh participant list (catches auto-spawned entities)
        if (!this._lastListRefresh || now - this._lastListRefresh > 2000) {
            this._lastListRefresh = now;
            this.updatePlayerList();
        }
    }

    draw() {
        // --- Draw List Panel ---
        const lctx = this.listContext;
        const lw = this.listCanvas.width;
        const lh = this.listCanvas.height;

        lctx.clearRect(0, 0, lw, lh);
        lctx.save();
        lctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.drawRoundedRect(lctx, 0, 0, 250, 40 + (this.playerNames.length * 30), 15);
        lctx.fill();

        lctx.font = 'bold 28px Inter, Arial, sans-serif';
        lctx.fillStyle = '#00ffff';
        lctx.fillText('PARTICIPANTS:', 20, 45);

        lctx.font = '22px Inter, Arial, sans-serif';
        lctx.fillStyle = '#ffffff';
        this.playerNames.forEach((name, i) => {
            lctx.fillText(name, 20, 85 + (i * 30));
        });
        lctx.restore();
        if (this.listTexture) this.listTexture.needsUpdate = true;

        // --- Draw Notification Panel ---
        const nctx = this.noteContext;
        const nw = this.noteCanvas.width;
        const nh = this.noteCanvas.height;

        nctx.clearRect(0, 0, nw, nh);
        if (this.notifications.length > 0) {
            const n = this.notifications[0]; // Just show topmost/latest
            const age = performance.now() - n.startTime;
            const opacity = Math.min(1.0, 1.0 - (age / n.duration) * 1.5);

            if (opacity > 0) {
                nctx.save();
                nctx.globalAlpha = opacity;
                nctx.textAlign = 'center';

                // Horizon OS style pill
                nctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                this.drawRoundedRect(nctx, nw / 2 - 300, nh / 2 - 30, 600, 60, 30);
                nctx.fill();

                // Border glow
                nctx.strokeStyle = '#ff00ff';
                nctx.lineWidth = 2;
                nctx.stroke();

                nctx.font = 'bold 24px Inter, Arial, sans-serif';
                nctx.fillStyle = '#ffffff';
                nctx.fillText(n.text, nw / 2, nh / 2 + 8);
                nctx.restore();
            }
        }
        if (this.noteTexture) this.noteTexture.needsUpdate = true;
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
