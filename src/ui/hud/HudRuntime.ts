import * as THREE from 'three';
import eventBus from '../../app/events/EventBus';
import { AppContext } from '../../app/AppContext';
import { EVENTS } from '../../shared/constants/Constants';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { UITheme } from '../shared/UITheme';
import type { ISystemNotificationPayload } from '../../shared/contracts/INotification';

interface Notification {
    text: string;
    startTime: number;
    duration: number;
    lines: string[];
    panelWidth: number;
    panelHeight: number;
}

export class HudRuntime implements IUpdatable {
    public group: THREE.Group;
    private noteCanvas: HTMLCanvasElement;
    private noteContext: CanvasRenderingContext2D;
    private noteTexture: THREE.CanvasTexture | null = null;
    private noteMesh: THREE.Mesh | null = null;

    private crosshair: THREE.Mesh | null = null;
    private opacity: number = 0.8;
    private notifications: Notification[] = [];
    private maxNotifications: number = 1;

    constructor(private context: AppContext) {
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

        eventBus.on(EVENTS.SYSTEM_NOTIFICATION, (note: string | ISystemNotificationPayload) => {
            const payload = typeof note === 'string'
                ? { message: note, level: 'info', durationMs: 8000 } as ISystemNotificationPayload
                : note;
            this.showNotification(payload.message, payload.durationMs ?? 4000);
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
        const layout = this.layoutNotificationText(text);
        this.notifications.push({
            text: text,
            startTime: performance.now(),
            duration: duration,
            lines: layout.lines,
            panelWidth: layout.panelWidth,
            panelHeight: layout.panelHeight
        });
        if (this.notifications.length > this.maxNotifications) {
            this.notifications.shift();
        }
        this.draw();
    }

    public update(delta: number): void {
        const now = performance.now();
        if (this.crosshair) {
            const isXR = this.context.runtime.render?.isXRPresenting();
            this.crosshair.visible = !isXR;
        }

        const initialCount = this.notifications.length;
        this.notifications = this.notifications.filter(n => (now - n.startTime) < n.duration);
        if (this.notifications.length !== initialCount) {
            this.draw();
        }
        this.updateNotificationOpacity(now);
    }

    private draw(): void {
        const nctx = this.noteContext;
        nctx.clearRect(0, 0, this.noteCanvas.width, this.noteCanvas.height);
        if (this.notifications.length > 0) {
            const n = this.notifications[0];
            nctx.save();
            nctx.textAlign = 'center';
            nctx.fillStyle = UITheme.colors.panelBg;
            this.drawRoundedRect(
                nctx,
                this.noteCanvas.width / 2 - n.panelWidth / 2,
                this.noteCanvas.height / 2 - n.panelHeight / 2,
                n.panelWidth,
                n.panelHeight,
                UITheme.styling.cornerRadius * 2
            );
            nctx.fill();
            nctx.strokeStyle = UITheme.colors.secondary;
            nctx.lineWidth = UITheme.styling.borderWidth;
            nctx.stroke();
            nctx.font = `bold 28px ${UITheme.typography.fontFamily}`;
            nctx.fillStyle = UITheme.colors.text;

            const lineHeight = 34;
            const startY = this.noteCanvas.height / 2 - ((n.lines.length - 1) * lineHeight) / 2 + 8;
            for (let i = 0; i < n.lines.length; i++) {
                nctx.fillText(n.lines[i], this.noteCanvas.width / 2, startY + i * lineHeight);
            }
            nctx.restore();
        }
        if (this.noteTexture) this.noteTexture.needsUpdate = true;
    }

    private updateNotificationOpacity(now: number): void {
        if (!this.noteMesh) return;
        const material = this.noteMesh.material as THREE.MeshBasicMaterial;
        const current = this.notifications[0];
        if (!current) {
            material.opacity = 0;
            return;
        }

        const age = now - current.startTime;
        const t = Math.max(0, Math.min(1, age / Math.max(1, current.duration)));
        // Keep full visibility for most of the lifetime; fade in the tail.
        const fade = t < 0.7 ? 1 : Math.max(0, 1 - ((t - 0.7) / 0.3));
        material.opacity = this.opacity * fade;
    }

    private layoutNotificationText(text: string): { lines: string[]; panelWidth: number; panelHeight: number } {
        const ctx = this.noteContext;
        const maxTextWidth = 840;
        const minPanelWidth = 420;
        const maxPanelWidth = 920;
        const lineHeight = 34;
        const maxLines = 4;

        ctx.save();
        ctx.font = `bold 28px ${UITheme.typography.fontFamily}`;

        const words = (text || '').trim().split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let current = '';

        const pushCurrent = () => {
            if (current.length > 0) {
                lines.push(current);
                current = '';
            }
        };

        for (const word of words) {
            const candidate = current.length > 0 ? `${current} ${word}` : word;
            if (ctx.measureText(candidate).width <= maxTextWidth) {
                current = candidate;
            } else if (current.length === 0) {
                // Very long token (e.g. URL/id) fallback: force single-token line.
                current = word;
                pushCurrent();
            } else {
                pushCurrent();
                current = word;
            }
        }
        pushCurrent();

        const finalLines = lines.length > 0 ? lines : [''];
        if (finalLines.length > maxLines) {
            finalLines.length = maxLines;
            const last = finalLines[maxLines - 1];
            finalLines[maxLines - 1] = last.length > 1 ? `${last.slice(0, Math.max(1, last.length - 1))}…` : '…';
        }

        let widest = 0;
        for (const line of finalLines) {
            widest = Math.max(widest, ctx.measureText(line).width);
        }
        ctx.restore();

        const panelWidth = Math.max(minPanelWidth, Math.min(maxPanelWidth, widest + 80));
        const panelHeight = Math.max(60, 40 + finalLines.length * lineHeight);
        return { lines: finalLines, panelWidth, panelHeight };
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
