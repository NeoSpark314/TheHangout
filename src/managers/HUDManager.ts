import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { GameContext } from '../core/GameState';
import { EVENTS } from '../utils/Constants';
import { IUpdatable } from '../interfaces/IUpdatable';

interface Notification {
    text: string;
    startTime: number;
    duration: number;
}

export class HUDManager implements IUpdatable {
    public group: THREE.Group;
    private noteCanvas: HTMLCanvasElement;
    private noteContext: CanvasRenderingContext2D;
    private noteTexture: THREE.CanvasTexture | null = null;
    private noteMesh: THREE.Mesh | null = null;

    private crosshair: THREE.Mesh | null = null;
    private opacity: number = 0.8;
    private notifications: Notification[] = [];
    private maxNotifications: number = 1;

    constructor(private context: GameContext) {
        this.group = new THREE.Group();
        this.group.raycast = () => { }; // Disable raycasting for the whole HUD group

        this.noteCanvas = document.createElement('canvas');
        this.noteContext = this.noteCanvas.getContext('2d')!;
        this.noteCanvas.width = 1024;
        this.noteCanvas.height = 256;

        this.init();

        eventBus.on(EVENTS.REMOTE_NAME_UPDATED, (data: { name: string }) => {
            this.showNotification(`${data.name} joined the hangout!`);
        });

        eventBus.on(EVENTS.SYSTEM_NOTIFICATION, (msg: string) => {
            console.log('[HUDManager] System Notification received:', msg);
            this.showNotification(`SYSTEM: ${msg}`, 8000);
        });

    }

    private init(): void {
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
        this.noteMesh.position.set(0, -0.35, -1.0);
        this.group.add(this.noteMesh);

        const crosshairGeo = new THREE.RingGeometry(0.002, 0.004, 32);
        const crosshairMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.5,
            depthTest: false,
            depthWrite: false
        });
        this.crosshair = new THREE.Mesh(crosshairGeo, crosshairMat);
        this.crosshair.position.set(0, 0, -1.0);
        this.group.add(this.crosshair);

        this.draw();
    }


    public showNotification(text: string, duration: number = 4000): void {
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

    public update(delta: number): void {
        const now = performance.now();
        if (this.crosshair) {
            const isXR = this.context.managers.render?.isXRPresenting();
            this.crosshair.visible = !isXR;
        }

        const initialCount = this.notifications.length;
        this.notifications = this.notifications.filter(n => (now - n.startTime) < n.duration);
        if (this.notifications.length !== initialCount || this.notifications.length > 0) {
            this.draw();
        }
    }

    private draw(): void {
        const nctx = this.noteContext;
        nctx.clearRect(0, 0, this.noteCanvas.width, this.noteCanvas.height);
        if (this.notifications.length > 0) {
            const n = this.notifications[0];
            const age = performance.now() - n.startTime;
            const opacity = Math.min(1.0, 1.0 - (age / n.duration) * 1.5);
            if (opacity > 0) {
                nctx.save();
                nctx.globalAlpha = opacity;
                nctx.textAlign = 'center';
                nctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                this.drawRoundedRect(nctx, this.noteCanvas.width / 2 - 300, this.noteCanvas.height / 2 - 30, 600, 60, 30);
                nctx.fill();
                nctx.strokeStyle = '#ff00ff';
                nctx.lineWidth = 2;
                nctx.stroke();
                nctx.font = 'bold 24px Inter, Arial, sans-serif';
                nctx.fillStyle = '#ffffff';
                nctx.fillText(n.text, this.noteCanvas.width / 2, this.noteCanvas.height / 2 + 8);
                nctx.restore();
            }
        }
        if (this.noteTexture) this.noteTexture.needsUpdate = true;
    }

    private drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
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
