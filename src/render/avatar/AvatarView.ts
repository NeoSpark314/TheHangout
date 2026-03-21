import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import { IAvatarConfig, normalizeAvatarConfig } from '../../shared/contracts/IAvatar';
import { validateVrmUrl } from '../../shared/avatar/AvatarUrlUtils';
import { EntityView } from '../views/EntityView';
import { StickFigureView, IPlayerViewState } from './stickfigure/StickFigureView';
import { VrmAvatarView } from './vrm/VrmAvatarView';

class AvatarRenderBudget {
    private static readonly MAX_ACTIVE_VRMS = 6;
    private static readonly views = new Set<AvatarView>();

    public static register(view: AvatarView): void {
        this.views.add(view);
        this.recalculate();
    }

    public static unregister(view: AvatarView): void {
        this.views.delete(view);
        this.recalculate();
    }

    public static recalculate(): void {
        const candidates = Array.from(this.views).filter((view) => view.isVrmCandidate());
        if (candidates.length === 0) {
            for (const view of this.views) {
                view.setBudgetAllowed(false);
            }
            return;
        }

        const render = candidates[0].getRenderContext();
        const camera = render?.camera;
        if (!camera) {
            for (const view of this.views) {
                view.setBudgetAllowed(false);
            }
            return;
        }

        const scored = candidates.map((view) => ({
            view,
            isLocal: view.isLocalAvatar(),
            isVisible: view.isVisibleTo(camera),
            distance: view.distanceToCamera(camera)
        }));

        scored.sort((a, b) => {
            if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
            if (a.isVisible !== b.isVisible) return a.isVisible ? -1 : 1;
            return a.distance - b.distance;
        });

        const allowed = new Set(scored.slice(0, AvatarRenderBudget.MAX_ACTIVE_VRMS).map((entry) => entry.view));
        for (const view of this.views) {
            view.setBudgetAllowed(allowed.has(view));
        }
    }
}

export class AvatarView extends EntityView<IPlayerViewState> {
    private readonly stickView: StickFigureView;
    private vrmView: VrmAvatarView | null = null;
    private activeView: EntityView<IPlayerViewState>;
    private avatarConfig: IAvatarConfig;
    private lastState: IPlayerViewState | null = null;
    private pendingVoiceStream: MediaStream | null = null;
    private muted = false;
    private loadingVrmUrl: string | null = null;
    private activeVrmUrl: string | null = null;
    private budgetAllowed = false;
    private destroyed = false;

    constructor(
        private readonly context: AppContext,
        {
            color = 0x00ffff,
            isLocal = false,
            avatarConfig
        }: {
            color?: string | number;
            isLocal?: boolean;
            avatarConfig?: Partial<IAvatarConfig>;
        } = {}
    ) {
        super(new THREE.Group());
        this.avatarConfig = normalizeAvatarConfig({
            color,
            ...avatarConfig
        });

        this.stickView = new StickFigureView(this.context, {
            color: this.avatarConfig.color,
            isLocal
        });
        this.activeView = this.stickView;
        this.mesh.add(this.stickView.mesh);
        this.mesh.userData.isLocalAvatar = isLocal;
        AvatarRenderBudget.register(this);
        this.syncViewMode();
    }

    public applyState(state: IPlayerViewState, delta: number): void {
        this.lastState = state;
        this.activeView.applyState(state, delta);
        AvatarRenderBudget.recalculate();
    }

    public setColor(color: string | number): void {
        this.avatarConfig = normalizeAvatarConfig({
            ...this.avatarConfig,
            color
        });
        this.stickView.setColor(color);
        this.activeView.setColor(color);
        if (this.vrmView && this.activeView !== this.vrmView) {
            this.vrmView.setColor(color);
        }
    }

    public setName(name: string): void {
        this.activeView.setName(name);
    }

    public attachVoiceStream(stream: MediaStream): void {
        this.pendingVoiceStream = stream;
        this.activeView.attachVoiceStream(stream);
    }

    public attachAudioChunk(data: { chunk: string; isHeader: boolean } | string): void {
        (this.activeView as unknown as { attachAudioChunk: (payload: { chunk: string; isHeader: boolean } | string) => void }).attachAudioChunk(data);
    }

    public getAudioLevel(): number {
        return this.activeView.getAudioLevel();
    }

    public setMuted(muted: boolean): void {
        this.muted = muted;
        (this.activeView as unknown as { setMuted?: (next: boolean) => void }).setMuted?.(muted);
    }

    public setAvatarConfig(config: Partial<IAvatarConfig>): void {
        this.avatarConfig = normalizeAvatarConfig({
            ...this.avatarConfig,
            ...config
        });
        this.stickView.setColor(this.avatarConfig.color);
        AvatarRenderBudget.recalculate();
        this.syncViewMode();
    }

    public destroy(): void {
        this.destroyed = true;
        AvatarRenderBudget.unregister(this);
        this._cleanupMesh();
        this.vrmView?.destroy();
        this.stickView.destroy();
    }

    public isLocalAvatar(): boolean {
        return !!this.mesh.userData.isLocalAvatar;
    }

    public isVrmCandidate(): boolean {
        return this.hasValidVrmConfig();
    }

    public getRenderContext(): AppContext['runtime']['render'] | undefined {
        return this.context.runtime.render;
    }

    public distanceToCamera(camera: THREE.Camera): number {
        const position = this.lastState?.position;
        if (!position) return Number.POSITIVE_INFINITY;
        return camera.position.distanceTo(new THREE.Vector3(position.x, position.y, position.z));
    }

    public isVisibleTo(camera: THREE.Camera): boolean {
        const position = this.lastState?.position;
        if (!position) return false;

        const projected = new THREE.Vector3(position.x, position.y + 1.4, position.z).project(camera);
        return projected.z >= -1 && projected.z <= 1
            && Math.abs(projected.x) <= 1.2
            && Math.abs(projected.y) <= 1.2;
    }

    public setBudgetAllowed(allowed: boolean): void {
        if (this.budgetAllowed === allowed) return;
        this.budgetAllowed = allowed;
        this.syncViewMode();
    }

    private hasValidVrmConfig(): boolean {
        if (this.avatarConfig.renderMode !== 'vrm-auto' || !this.avatarConfig.vrmUrl) {
            return false;
        }

        if (typeof (this.context.runtime.assets as { loadVRM?: unknown }).loadVRM !== 'function') {
            return false;
        }

        if (typeof window === 'undefined') return false;
        return validateVrmUrl(this.avatarConfig.vrmUrl, window.location.href, window.location.origin).valid;
    }

    private syncViewMode(): void {
        if (!this.budgetAllowed || !this.hasValidVrmConfig()) {
            this.switchTo(this.stickView);
            return;
        }

        this.ensureVrmView();
    }

    private async ensureVrmView(): Promise<void> {
        const url = this.avatarConfig.vrmUrl;
        if (!url || this.destroyed) return;

        if (this.vrmView && this.activeVrmUrl === url) {
            this.switchTo(this.vrmView);
            return;
        }

        if (this.loadingVrmUrl === url) {
            return;
        }

        this.loadingVrmUrl = url;
        try {
            const vrmInstance = await this.context.runtime.assets.loadVRM(url);
            if (this.destroyed || this.avatarConfig.vrmUrl !== url || !this.budgetAllowed) {
                vrmInstance.dispose();
                return;
            }

            this.vrmView?.destroy();
            this.vrmView = new VrmAvatarView(this.context, vrmInstance, {
                color: this.avatarConfig.color,
                isLocal: this.isLocalAvatar()
            });
            this.activeVrmUrl = url;
            this.switchTo(this.vrmView);
        } catch (error) {
            console.warn('[AvatarView] Falling back to stick avatar after VRM load failure:', error);
            this.activeVrmUrl = null;
            this.switchTo(this.stickView);
        } finally {
            if (this.loadingVrmUrl === url) {
                this.loadingVrmUrl = null;
            }
        }
    }

    private switchTo(nextView: EntityView<IPlayerViewState>): void {
        if (this.activeView === nextView) return;

        (this.activeView as unknown as { setMuted?: (next: boolean) => void }).setMuted?.(true);
        if (this.activeView.mesh.parent === this.mesh) {
            this.mesh.remove(this.activeView.mesh);
        }

        this.activeView = nextView;
        if (this.activeView.mesh.parent !== this.mesh) {
            this.mesh.add(this.activeView.mesh);
        }

        this.activeView.setColor(this.avatarConfig.color);
        if (this.lastState) {
            this.activeView.applyState(this.lastState, 0);
        }

        if (this.pendingVoiceStream) {
            this.activeView.attachVoiceStream(this.pendingVoiceStream);
        }

        (this.activeView as unknown as { setMuted?: (next: boolean) => void }).setMuted?.(this.muted);
    }
}
