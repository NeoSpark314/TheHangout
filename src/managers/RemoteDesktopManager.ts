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
    texture: THREE.CanvasTexture;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
}

const MY_SCREENS_STORAGE_KEY = 'hangout_myScreens';

export class RemoteDesktopManager implements IUpdatable {
    private configs: IMyScreenConfig[] = [];
    private onlineByKey: Map<string, boolean> = new Map();
    private activeByKey: Set<string> = new Set();
    private surfacesByKey: Map<string, IRenderSurface> = new Map();
    private decodeImage = new Image();

    constructor(private context: GameContext) {
        this.decodeImage.decoding = 'async';
        this.loadConfigsFromStorage();
    }

    public update(_delta: number): void { }

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
            eventBus.emit(EVENTS.SYSTEM_NOTIFICATION, `Screen "${name || key}" is already active.`);
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

    public isActive(key: string): boolean {
        return this.activeByKey.has(key);
    }

    public handleSourcesStatus(payload: IDesktopSourcesStatusResponsePayload): void {
        const statuses = payload.statuses || {};
        this.onlineByKey.clear();
        for (const [key, isOnline] of Object.entries(statuses)) {
            this.onlineByKey.set(key, !!isOnline);
        }

        this.activeByKey.clear();
        for (const key of payload.activeKeys || []) {
            this.activeByKey.add(key);
        }
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    public handleStreamSummoned(payload: IDesktopStreamSummonedPayload): void {
        this.activeByKey.add(payload.key);
        this.ensureSurface(payload.key, payload.name || payload.key, payload.anchor, payload.quaternion);
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    public handleStreamStopped(payload: IDesktopStreamStoppedPayload): void {
        this.activeByKey.delete(payload.key);
        this.removeSurface(payload.key);
        eventBus.emit(EVENTS.SYSTEM_NOTIFICATION, `Screen "${payload.key}" stopped.`);
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    public handleStreamOffline(payload: IDesktopStreamOfflinePayload): void {
        this.activeByKey.delete(payload.key);
        this.onlineByKey.set(payload.key, false);
        this.removeSurface(payload.key);
        eventBus.emit(EVENTS.SYSTEM_NOTIFICATION, `Screen key "${payload.key}" is offline.`);
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    public handleStreamFrame(payload: IDesktopStreamFramePayload): void {
        const surface = this.ensureSurface(payload.key, payload.name || payload.key, payload.anchor, payload.quaternion);
        this.decodeImage.onload = () => {
            surface.ctx.drawImage(this.decodeImage, 0, 0, surface.canvas.width, surface.canvas.height);
            surface.texture.needsUpdate = true;
        };
        this.decodeImage.src = payload.dataUrl;
        this.activeByKey.add(payload.key);
        eventBus.emit(EVENTS.DESKTOP_SCREENS_UPDATED);
    }

    private ensureSurface(
        key: string,
        name: string,
        anchor?: [number, number, number],
        quaternion?: [number, number, number, number]
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
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#00ffff';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(`Waiting for ${name}...`, 40, 80);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;

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

        if (anchor && quaternion) {
            group.position.set(anchor[0], Math.max(1.2, anchor[1] - 0.1), anchor[2] - 1.4);
            group.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
        } else {
            group.position.set(0, 1.5, -2.4);
        }

        this.context.managers.render.scene.add(group);

        const surface: IRenderSurface = {
            key,
            name,
            group,
            texture,
            canvas,
            ctx
        };
        this.surfacesByKey.set(key, surface);
        return surface;
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
