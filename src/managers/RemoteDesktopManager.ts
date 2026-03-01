import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { GameContext } from '../core/GameState';
import { IUpdatable } from '../interfaces/IUpdatable';
import {
    IDesktopSourcesStatusResponsePayload,
    IDesktopStreamFramePayload,
    IDesktopStreamOfflinePayload,
    IDesktopStreamStoppedPayload,
    IDesktopStreamSummonedPayload
} from '../interfaces/INetworkPacket';
import { EVENTS, PACKET_TYPES } from '../utils/Constants';

export interface IMyScreenConfig {
    name: string;
    key: string;
}

interface IRenderSurface {
    key: string;
    name: string;
    group: THREE.Group;
    screenMesh: THREE.Mesh;
    frameMesh: THREE.Mesh;
    texture: THREE.CanvasTexture;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    decodeImage: HTMLImageElement;
    lastFrameTs: number;
    isBillboard: boolean;
}

const MY_SCREENS_STORAGE_KEY = 'hangout_myScreens';

export class RemoteDesktopManager implements IUpdatable {
    private configs: IMyScreenConfig[] = [];
    private onlineByKey: Map<string, boolean> = new Map();
    private capturingByKey: Map<string, boolean> = new Map();
    private activeByKey: Set<string> = new Set();
    private surfacesByKey: Map<string, IRenderSurface> = new Map();

    constructor(private context: GameContext) {
        this.loadConfigsFromStorage();
    }

    public update(_delta: number): void {
        const renderMgr = this.context.managers.render;
        if (!renderMgr || !renderMgr.camera) return;

        const camPos = new THREE.Vector3();
        renderMgr.camera.getWorldPosition(camPos);

        for (const surface of this.surfacesByKey.values()) {
            if (this.activeByKey.has(surface.key) && surface.isBillboard) {
                surface.group.lookAt(camPos.x, surface.group.position.y, camPos.z);
            }
        }
    }

    public loadConfigsFromStorage(): void {
        try {
            const raw = localStorage.getItem(MY_SCREENS_STORAGE_KEY);
            if (!raw) {
                this.configs = [];
                return;
            }

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                this.configs = [];
                return;
            }

            this.configs = parsed
                .filter((item: unknown) => !!item && typeof item === 'object')
                .map((item: any) => ({
                    name: String(item.name || '').trim(),
                    key: String(item.key || '').trim()
                }))
                .filter((item: IMyScreenConfig) => item.name.length > 0 && item.key.length > 0);
        } catch {
            this.configs = [];
        }
    }

    public getConfigs(): IMyScreenConfig[] {
        return [...this.configs];
    }

    public setConfigs(configs: IMyScreenConfig[]): void {
        const cleaned = configs
            .map(c => ({ name: c.name.trim(), key: c.key.trim() }));

        this.configs = cleaned;
        localStorage.setItem(MY_SCREENS_STORAGE_KEY, JSON.stringify(cleaned));
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    public requestSourceStatus(): void {
        if (!this.context.roomId) return;
        const keys = this.configs
            .map(c => c.key)
            .filter(k => k.length > 0);
        this.context.managers.network.sendData(
            this.context.roomId,
            PACKET_TYPES.DESKTOP_SOURCES_STATUS_REQUEST,
            { keys }
        );
    }

    public summonStream(key: string, name?: string): void {
        if (!this.context.roomId) return;
        if (!this.isOnline(key)) {
            eventBus.emit(EVENTS.SYSTEM_NOTIFICATION, `Screen key "${key}" is offline.`);
            return;
        }
        if (this.isActive(key)) {
            eventBus.emit(EVENTS.SYSTEM_NOTIFICATION, `Screen "${name || key}" is already active in-room.`);
            return;
        }

        const payload: any = { key, name };
        const localPlayer: any = this.context.localPlayer;
        if (localPlayer?.headState) {
            const head = localPlayer.headState;
            payload.anchor = [head.position.x, head.position.y, head.position.z] as [number, number, number];
            payload.quaternion = [head.quaternion.x, head.quaternion.y, head.quaternion.z, head.quaternion.w] as [number, number, number, number];
        }

        this.context.managers.network.sendData(
            this.context.roomId,
            PACKET_TYPES.DESKTOP_STREAM_SUMMON,
            payload
        );
    }

    public stopStream(key: string): void {
        if (!this.context.roomId) return;
        this.context.managers.network.sendData(
            this.context.roomId,
            PACKET_TYPES.DESKTOP_STREAM_STOP,
            { key }
        );
    }

    public isOnline(key: string): boolean {
        return this.onlineByKey.get(key) === true;
    }

    public isCapturing(key: string): boolean {
        return this.capturingByKey.get(key) === true;
    }

    public isActive(key: string): boolean {
        return this.activeByKey.has(key);
    }

    public handleSourcesStatus(payload: IDesktopSourcesStatusResponsePayload): void {
        const statuses = payload.statuses || {};
        this.onlineByKey.clear();
        for (const [key, isOnline] of Object.entries(statuses)) {
            this.onlineByKey.set(key, !!isOnline);
        }

        this.capturingByKey.clear();
        for (const key of payload.capturingKeys || []) {
            this.capturingByKey.set(key, true);
        }

        this.activeByKey.clear();
        for (const key of payload.activeKeys || []) {
            this.activeByKey.add(key);
            // Ensure surface exists for all active room streams, using the name from activeNames if available
            const name = (payload.activeNames && payload.activeNames[key]) || key;
            this.ensureSurface(key, name);
        }

        // Handle standby visuals for active surfaces
        for (const [key, surface] of this.surfacesByKey.entries()) {
            if (this.activeByKey.has(key)) {
                if (!this.isCapturing(key)) {
                    this.drawStandby(surface);
                }
            } else {
                // Not active in this room anymore
                this.removeSurface(key);
            }
        }
        this.refreshActiveLayouts();
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    public handleStreamSummoned(payload: IDesktopStreamSummonedPayload): void {
        this.activeByKey.add(payload.key);
        this.ensureSurface(payload.key, payload.name || payload.key);
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
        this.refreshActiveLayouts();
    }

    public handleStreamStopped(payload: IDesktopStreamStoppedPayload): void {
        this.activeByKey.delete(payload.key);
        this.removeSurface(payload.key);
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
        this.refreshActiveLayouts();
    }

    public handleStreamOffline(payload: IDesktopStreamOfflinePayload): void {
        this.activeByKey.delete(payload.key);
        this.onlineByKey.set(payload.key, false);
        this.removeSurface(payload.key);
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
        this.refreshActiveLayouts();
    }

    public handleStreamFrame(payload: IDesktopStreamFramePayload): void {
        const surface = this.ensureSurface(payload.key, payload.name || payload.key);
        this.capturingByKey.set(payload.key, true);
        this.activeByKey.add(payload.key);

        const incomingTs = payload.ts || Date.now();
        if (incomingTs < surface.lastFrameTs) return; // Drop out-of-order or late frames
        surface.lastFrameTs = incomingTs;

        if (payload.dataUrl) {
            surface.decodeImage.onload = () => {
                // Final check: are we still supposed to be "Live"?
                if (this.isCapturing(payload.key) && incomingTs >= surface.lastFrameTs) {
                    surface.ctx.drawImage(surface.decodeImage, 0, 0, surface.canvas.width, surface.canvas.height);
                    surface.texture.needsUpdate = true;
                }
            };
            surface.decodeImage.src = payload.dataUrl;
        }
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    public handleBinaryFrame(buffer: ArrayBuffer): void {
        // [1b Type][1b KeyLen][KeyLen bytes Key][Payload]
        const view = new DataView(buffer);
        const keyLen = view.getUint8(1);
        const decoder = new TextDecoder();
        const key = decoder.decode(new Uint8Array(buffer, 2, keyLen));
        const imageData = new Uint8Array(buffer, 2 + keyLen);

        const surface = this.surfacesByKey.get(key);
        if (!surface) return;

        this.capturingByKey.set(key, true);
        this.activeByKey.add(key);

        const incomingTs = Date.now();
        if (incomingTs < surface.lastFrameTs) return;
        surface.lastFrameTs = incomingTs;

        // Async decoding optimized for VR performance
        const blob = new Blob([imageData]);
        createImageBitmap(blob).then((bitmap) => {
            if (this.isCapturing(key) && incomingTs >= surface.lastFrameTs) {
                // Dynamic resolution support
                if (surface.canvas.width !== bitmap.width || surface.canvas.height !== bitmap.height) {
                    surface.canvas.width = bitmap.width;
                    surface.canvas.height = bitmap.height;

                    // Changing canvas dimensions clears context; re-acquire and reset state if needed
                    surface.ctx = surface.canvas.getContext('2d')!;

                    // Force Three.js to re-allocate GPU texture by disposing old one
                    surface.texture.dispose();

                    // Update Aspect Ratio
                    const aspect = bitmap.width / bitmap.height;

                    // We keep the height fixed at 0.9 (mesh base) and adjust width.
                    // The PlaneGeometry is already 1.6x0.9. 
                    // To get fixed height 0.9 with aspect X, width must be 0.9 * aspect.
                    // Mesh scale X = (0.9 * aspect) / 1.6
                    const meshScaleX = (0.9 * aspect) / 1.6;

                    surface.screenMesh.scale.set(meshScaleX, 1, 1);
                    // Frame is slightly larger: 1.66x0.96. We scale it proportionally.
                    surface.frameMesh.scale.set(meshScaleX, 1, 1);
                }

                surface.ctx.drawImage(bitmap, 0, 0);
                surface.texture.needsUpdate = true;
            }
            bitmap.close();
        }).catch(err => {
            console.error('[RemoteDesktopManager] Async decode failed:', err);
        });

        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    private ensureSurface(
        key: string,
        name: string
    ): IRenderSurface {
        const existing = this.surfacesByKey.get(key);
        if (existing) return existing;

        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Canvas 2D context unavailable for remote desktop surface');
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

        const decodeImage = new Image();
        decodeImage.decoding = 'async';

        const screenMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1.6, 0.9),
            new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
        );

        const frameMesh = new THREE.Mesh(
            new THREE.BoxGeometry(1.66, 0.96, 0.03),
            new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.2, roughness: 0.85 })
        );
        frameMesh.position.set(0, 0, -0.02);

        const group = new THREE.Group();
        group.name = `remote-desktop:${key}`;
        group.add(frameMesh);
        group.add(screenMesh);

        // Initial default position until layout refreshes
        group.position.set(0, 1.5, -2.4);
        this.context.managers.render.scene.add(group);

        const surface: IRenderSurface = {
            key,
            name,
            canvas,
            ctx,
            texture,
            decodeImage,
            lastFrameTs: 0,
            isBillboard: false,
            group,
            screenMesh,
            frameMesh
        };

        this.drawStandby(surface);
        this.surfacesByKey.set(key, surface);

        this.refreshActiveLayouts();
        return surface;
    }

    private refreshActiveLayouts(): void {
        // Collect and sort active keys so they stack consistently
        const sortedActive = Array.from(this.activeByKey).sort();
        const total = sortedActive.length;

        // Hide/Show duck based on screen count
        this.context.managers.room.toggleHologram(total === 0);

        sortedActive.forEach((key, index) => {
            const surface = this.surfacesByKey.get(key);
            if (!surface) return;

            const layout = this.context.managers.room.getDesktopLayout(index, total);
            surface.group.position.set(layout.position[0], layout.position[1], layout.position[2]);

            if (layout.rotation) {
                surface.group.quaternion.set(layout.rotation[0], layout.rotation[1], layout.rotation[2], layout.rotation[3]);
            }

            if (layout.scale) {
                surface.group.scale.set(layout.scale[0], layout.scale[1], layout.scale[2]);
            }

            surface.isBillboard = !!layout.billboard;
        });
    }

    private drawStandby(surface: IRenderSurface): void {
        const { ctx, canvas, texture, name } = surface;

        // Block any pending frame decodes from overwriting this
        surface.lastFrameTs = Date.now();
        surface.decodeImage.onload = null;

        // Background gradient
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, '#0a0d14');
        grad.addColorStop(1, '#1a1f2c');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid pattern
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 40) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += 40) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
        }

        // Center Text
        ctx.fillStyle = '#00ffff';
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 15;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.font = 'bold 48px Outfit, sans-serif';
        ctx.fillText(name.toUpperCase(), canvas.width / 2, canvas.height / 2 - 40);

        ctx.shadowBlur = 0;
        ctx.font = '300 28px Outfit, sans-serif';
        ctx.fillStyle = 'rgba(0, 255, 255, 0.6)';
        ctx.fillText('STANDBY • WAITING FOR BROADCAST', canvas.width / 2, canvas.height / 2 + 30);

        // Status indicator
        ctx.beginPath();
        ctx.arc(canvas.width / 2 - 140, canvas.height / 2 + 30, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffaa00'; // Amber for standby
        ctx.fill();

        texture.needsUpdate = true;
    }

    private removeSurface(key: string): void {
        const surface = this.surfacesByKey.get(key);
        if (!surface) return;

        this.context.managers.render.scene.remove(surface.group);
        surface.group.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (!mesh.geometry || !mesh.material) return;
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                mesh.material.dispose();
            }
        });
        surface.texture.dispose();
        this.surfacesByKey.delete(key);
    }
}
