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
import { RuntimeDiagnostics } from './diagnostics/RuntimeDiagnostics';
import eventBus from './events/EventBus';
import { EVENTS } from '../shared/constants/Constants';
import { EnvironmentBuilder } from '../assets/procedural/EnvironmentBuilder';
import { IUpdatable } from '../shared/contracts/IUpdatable';

/**
 * Orchestrates the application lifecycle: Initialization, Bootstrapping, and Shutdown.
 */
export class App {
    private engine: Engine;
    public context: AppContext;
    private gameplayStarted = false;
    private gameplayStartPromise: Promise<void> | null = null;
    private physicsPresentationSystem: PhysicsPresentationSystem | null = null;
    private menuEnvironment: EnvironmentBuilder | null = null;

    constructor() {
        this.context = new AppContext();
        this.engine = new Engine(this.context);
        this.context.ensureGameplayStarted = this.ensureGameplayStarted.bind(this);
    }

    public async bootstrap(): Promise<void> {
        console.log('[App] Bootstrapping...');

        try {
            await this.detectServerInfo();
            this.initializeRuntime();
            this.setupGlobalEventListeners();
            this.initializeMenuEnvironment();

            // Register engine systems in their final order.
            // Heavy gameplay runtime stays dormant until a session is requested.
            await this.initSystems();

            // Start engine loop immediately for main-menu render/UI.
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
                    console.log('[App] Dedicated server detected — using local PeerJS signaling.');
                }
            }
        } catch (e) {
            // Silence: server-info is optional
        }
    }

    private initializeRuntime(): void {
        this.context.setRuntime('diagnostics', new RuntimeDiagnostics());
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
        this.physicsPresentationSystem = new PhysicsPresentationSystem(this.context);

        // Register systems to Engine in the exact desired execution order
        this.addAlwaysSystem(runtime.network);
        this.addAlwaysSystem(runtime.input);
        this.addGameplaySystem(runtime.entity);

        // Physics needs a small wrapper because its update method is called 'step' and only takes delta
        if (runtime.physics) {
            this.addGameplaySystem({
                update: (delta) => runtime.physics!.step(delta)
            });
        }
        this.addGameplaySystem(this.physicsPresentationSystem);
        this.addGameplaySystem(runtime.session);
        this.addGameplaySystem(runtime.mount);
        this.addGameplaySystem(runtime.social);
        this.addGameplaySystem(runtime.particles);
        this.addGameplaySystem(runtime.remoteDesktop);
        this.addAlwaysSystem(runtime.ui);
        this.addAlwaysSystem(runtime.hud);
        this.addGameplaySystem(runtime.vrUi);
        this.addGameplaySystem(runtime.debugRender);

        if (runtime.render) {
            this.engine.addSystem({
                update: (delta) => {
                    if (this.gameplayStarted) return;
                    this.menuEnvironment?.update(delta);
                }
            });
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

    private async ensureGameplayStarted(): Promise<void> {
        if (this.gameplayStarted) return;
        if (this.gameplayStartPromise) {
            await this.gameplayStartPromise;
            return;
        }

        const runtime = this.context.runtime;
        this.gameplayStartPromise = (async () => {
            this.menuEnvironment?.clearProcedural();
            this.menuEnvironment = null;

            await runtime.physics.init();

            if (runtime.render && runtime.session) {
                runtime.session.init(runtime.render.scene);
            }

            runtime.vrUi?.init();
            runtime.debugRender?.init();
            this.gameplayStarted = true;
            console.log('[App] Gameplay runtime initialized.');
        })();

        try {
            await this.gameplayStartPromise;
        } finally {
            this.gameplayStartPromise = null;
        }
    }

    private initializeMenuEnvironment(): void {
        const scene = this.context.runtime.render?.scene;
        if (!scene) return;

        this.menuEnvironment = new EnvironmentBuilder(scene, () => Math.random());
        this.menuEnvironment.applyConfig(this.context.sessionConfig);
    }

    private addGameplaySystem(system: IUpdatable | null | undefined): void {
        if (!system) return;
        this.engine.addSystem({
            update: (delta, frame) => {
                if (!this.gameplayStarted) return;
                system.update(delta, frame);
            }
        });
    }

    private addAlwaysSystem(system: IUpdatable | null | undefined): void {
        if (!system) return;
        this.engine.addSystem(system);
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
