import { AppContext } from './AppContext';
import { Engine } from './Engine';
import { FlatUiRuntime } from '../ui/flat/FlatUiRuntime';
import { NetworkRuntime } from '../network/transport/NetworkRuntime';
import { PhysicsRuntime } from '../physics/runtime/PhysicsRuntime';
import { RenderRuntime } from '../render/runtime/RenderRuntime';
import { PlayerPresenceService } from '../world/session/PlayerPresenceService';
import { EntityRegistry } from '../world/entities/EntityRegistry';
import { VoiceRuntime } from '../media/voice/VoiceRuntime';
import { HudRuntime } from '../ui/hud/HudRuntime';
import { InputRuntime } from '../input/controllers/InputRuntime';
import { SessionRuntime } from '../world/session/SessionRuntime';
import { AudioRuntime } from '../media/audio/AudioRuntime';
import { InteractionSystem } from '../world/systems/InteractionSystem';
import { AssetRuntime } from '../assets/runtime/AssetRuntime';
import { DrawingRuntime } from '../content/runtime/DrawingRuntime';
import { MountRuntime } from '../content/runtime/MountRuntime';
import { TrackingRuntime } from '../input/providers/TrackingRuntime';
import { XRTrackingProvider } from '../input/providers/XRTrackingProvider';
import { DesktopTrackingProvider } from '../input/providers/DesktopTrackingProvider';
import { AnimationSystem } from '../render/systems/AnimationSystem';
import { PhysicsPresentationSystem } from '../physics/systems/PhysicsPresentationSystem';
import { VrUiRuntime } from '../ui/vr/VrUiRuntime';
import { DebugRenderRuntime } from '../render/debug/DebugRenderRuntime';
import { FeatureReplicationService } from '../network/replication/FeatureReplicationService';
import { ParticleEffectSystem } from '../render/effects/ParticleEffectSystem';
import { SocialFeature } from '../features/social/SocialFeature';
import { RemoteDesktopFeature } from '../features/remoteDesktop/RemoteDesktopFeature';
import eventBus from './events/EventBus';
import { EVENTS } from '../shared/constants/Constants';

/**
 * Orchestrates the application lifecycle: Initialization, Bootstrapping, and Shutdown.
 */
export class App {
    private engine: Engine;
    public context: AppContext;

    constructor() {
        this.context = new AppContext();
        this.engine = new Engine(this.context);
    }

    public async bootstrap(): Promise<void> {
        console.log('[App] Bootstrapping...');

        try {
            await this.detectServerInfo();
            this.initializeRuntime();
            this.setupGlobalEventListeners();

            // 1. Infrastructure (Physics must be first)
            await this.context.runtime.physics.init();

            // 2. World (Requires Physics)
            await this.initSystems();

            // 3. Engine (Starts simulation)
            await this.engine.initialize();
            this.engine.start();

            console.log('[App] Bootstrap complete. Scene ready.');
            eventBus.emit(EVENTS.SCENE_READY);
        } catch (error) {
            console.error('[App] Fatal error during bootstrap:', error);
            throw error;
        }
    }

    private async detectServerInfo(): Promise<void> {
        try {
            const resp = await fetch('/api/server-info');
            if (resp.ok) {
                const info = await resp.json();
                if (info.local) {
                    this.context.isLocalServer = true;
                    console.log('[App] Local server detected — using local PeerJS signaling.');
                }
            }
        } catch (e) {
            // Silence: server-info is optional
        }
    }

    private initializeRuntime(): void {
        this.context.setRuntime('entity', new EntityRegistry(this.context));
        this.context.setRuntime('replication', new FeatureReplicationService(this.context));
        this.context.setRuntime('remoteDesktop', new RemoteDesktopFeature(this.context));
        this.context.setRuntime('ui', new FlatUiRuntime(this.context));
        this.context.setRuntime('network', new NetworkRuntime(this.context));
        this.context.setRuntime('media', new VoiceRuntime(this.context));
        this.context.setRuntime('render', new RenderRuntime(this.context));
        this.context.setRuntime('physics', new PhysicsRuntime(this.context));
        this.context.setRuntime('player', new PlayerPresenceService(this.context));
        this.context.setRuntime('input', new InputRuntime(this.context));
        this.context.setRuntime('hud', new HudRuntime(this.context));
        this.context.setRuntime('session', new SessionRuntime(this.context));
        this.context.setRuntime('audio', new AudioRuntime(this.context));
        this.context.setRuntime('assets', new AssetRuntime(this.context));
        this.context.setRuntime('drawing', new DrawingRuntime(this.context));
        this.context.setRuntime('mount', new MountRuntime(this.context));
        this.context.setRuntime('animation', new AnimationSystem());
        this.context.setRuntime('interaction', new InteractionSystem(this.context));
        this.context.setRuntime('vrUi', new VrUiRuntime(this.context));
        this.context.setRuntime('debugRender', new DebugRenderRuntime(this.context));
        this.context.setRuntime('particles', new ParticleEffectSystem(this.context.runtime.render.scene));
        this.context.setRuntime('social', new SocialFeature(this.context, this.context.runtime.particles));

        // Tracking Initialization
        const tracking = new TrackingRuntime(this.context);
        tracking.registerProvider(new XRTrackingProvider(this.context));
        tracking.registerProvider(new DesktopTrackingProvider(this.context));
        tracking.setProvider('desktop'); // Default
        this.context.setRuntime('tracking', tracking);
    }

    private setupGlobalEventListeners(): void {
        const runtime = this.context.runtime;

        // Audio Activation
        const resumeAudio = () => {
            runtime.audio.resume();
            window.removeEventListener('pointerdown', resumeAudio);
            window.removeEventListener('keydown', resumeAudio);
        };
        window.addEventListener('pointerdown', resumeAudio);
        window.addEventListener('keydown', resumeAudio);

        // Tracking Provider Switching
        eventBus.on(EVENTS.XR_SESSION_STARTED, () => {
            runtime.tracking.setProvider('xr');
        });
        eventBus.on(EVENTS.XR_SESSION_ENDED, () => {
            runtime.tracking.setProvider('desktop');
        });

        // HUD/Camera integration
        if (runtime.render && runtime.hud) {
            runtime.render.camera.add(runtime.hud.group);
        }

        // Network/Player Initialization
        eventBus.on(EVENTS.HOST_READY, (id: string) => this.initPlayerOnce(id));
        eventBus.on(EVENTS.SESSION_CONNECTED, (localId: string) => {
            if (!this.context.isHost && localId) {
                this.initPlayerOnce(localId);
            }
        });
    }

    private async initSystems(): Promise<void> {
        const runtime = this.context.runtime;

        if (runtime.render && runtime.session) {
            runtime.session.init(runtime.render.scene);
        }

        if (runtime.vrUi) {
            runtime.vrUi.init();
        }
        if (runtime.debugRender) {
            runtime.debugRender.init();
        }

        // Register systems to Engine in the exact desired execution order
        if (runtime.network) this.engine.addSystem(runtime.network as any);
        if (runtime.input) this.engine.addSystem(runtime.input as any);
        if (runtime.entity) this.engine.addSystem(runtime.entity as any);

        // Physics needs a small wrapper because its update method is called 'step' and only takes delta
        if (runtime.physics) {
            this.engine.addSystem({
                update: (delta) => runtime.physics!.step(delta)
            });
        }
        this.engine.addSystem(new PhysicsPresentationSystem(this.context));

        if (runtime.session) this.engine.addSystem(runtime.session as any);
        if (runtime.mount) this.engine.addSystem(runtime.mount as any);
        if (runtime.social) this.engine.addSystem(runtime.social as any);
        if (runtime.particles) this.engine.addSystem(runtime.particles as any);
        if (runtime.remoteDesktop) this.engine.addSystem(runtime.remoteDesktop as any);
        if (runtime.ui) this.engine.addSystem(runtime.ui as any);
        if (runtime.hud) this.engine.addSystem(runtime.hud as any);
        if (runtime.vrUi) this.engine.addSystem(runtime.vrUi as any);
        if (runtime.debugRender) this.engine.addSystem(runtime.debugRender as any);

        if (runtime.render) {
            this.engine.addSystem({
                update: (delta) => {
                    runtime.render!.update(delta, this.context.localPlayer);
                    runtime.render!.render();
                }
            });
        }

        // Tasks at the end of the frame
        if (runtime.input) {
            this.engine.onEndFrame(() => runtime.input!.clearJustPressed());
        }
    }

    private playerInitialized = false;
    private initPlayerOnce(id: string): void {
        if (this.playerInitialized || !id) return;

        const runtime = this.context.runtime;
        if (!this.context.isHost && runtime.session.assignedSpawnIndex === undefined) {
            console.warn('[App] Delaying guest player initialization until assignedSpawnIndex is available.');
            return;
        }

        this.playerInitialized = true;
        runtime.render.switchToPlayerView();

        runtime.player.init(id);
    }
}
