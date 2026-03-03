import { GameContext } from './AppContext';
import { GameEngine } from './Engine';
import { FlatUIManager } from '../ui/flat/FlatUiRuntime';
import { NetworkManager } from '../network/transport/NetworkRuntime';
import { PhysicsManager } from '../physics/runtime/PhysicsRuntime';
import { RenderManager } from '../render/runtime/RenderRuntime';
import { PlayerManager } from '../world/session/PlayerPresenceService';
import { EntityManager } from '../world/entities/EntityRegistry';
import { MediaManager } from '../media/voice/VoiceRuntime';
import { HUDManager } from '../ui/hud/HudRuntime';
import { InputManager } from '../input/controllers/InputRuntime';
import { SessionManager } from '../world/session/SessionRuntime';
import { AudioManager } from '../media/audio/AudioRuntime';
import { InteractionSystem } from '../world/systems/InteractionSystem';
import { AssetManager } from '../assets/runtime/AssetRuntime';
import { DrawingManager } from '../features/drawing/DrawingFeature';
import { TrackingManager } from '../input/providers/TrackingRuntime';
import { XRTrackingProvider } from '../input/providers/XRTrackingProvider';
import { DesktopTrackingProvider } from '../input/providers/DesktopTrackingProvider';
import { AnimationSystem } from '../render/systems/AnimationSystem';
import { PhysicsPresentationSystem } from '../physics/systems/PhysicsPresentationSystem';
import { VRUIManager } from '../ui/vr/VrUiRuntime';
import { DebugRenderManager } from '../render/debug/DebugRenderRuntime';
import { ReplicationManager } from '../network/replication/FeatureReplicationService';
import { ParticleSystemManager } from '../render/effects/ParticleEffectSystem';
import { SocialEffectsManager } from '../features/social/SocialFeature';
import { RemoteDesktopManager } from '../features/remoteDesktop/RemoteDesktopFeature';
import eventBus from './events/EventBus';
import { EVENTS } from '../shared/constants/Constants';

/**
 * Orchestrates the application lifecycle: Initialization, Bootstrapping, and Shutdown.
 */
export class App {
    private engine: GameEngine;
    public context: GameContext;

    constructor() {
        this.context = new GameContext();
        this.engine = new GameEngine(this.context);
    }

    public async bootstrap(): Promise<void> {
        console.log('[App] Bootstrapping...');

        try {
            await this.detectServerInfo();
            this.initializeManagers();
            this.setupGlobalEventListeners();

            // 1. Infrastructure (Physics must be first)
            await this.context.managers.physics.init();

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

    private initializeManagers(): void {
        this.context.setManager('entity', new EntityManager(this.context));
        this.context.setManager('replication', new ReplicationManager(this.context));
        this.context.setManager('remoteDesktop', new RemoteDesktopManager(this.context));
        this.context.setManager('ui', new FlatUIManager(this.context));
        this.context.setManager('network', new NetworkManager(this.context));
        this.context.setManager('media', new MediaManager(this.context));
        this.context.setManager('render', new RenderManager(this.context));
        this.context.setManager('physics', new PhysicsManager(this.context));
        this.context.setManager('player', new PlayerManager(this.context));
        this.context.setManager('input', new InputManager(this.context));
        this.context.setManager('hud', new HUDManager(this.context));
        this.context.setManager('session', new SessionManager(this.context));
        this.context.setManager('audio', new AudioManager(this.context));
        this.context.setManager('assets', new AssetManager(this.context));
        this.context.setManager('drawing', new DrawingManager(this.context.managers.render.scene, this.context));
        this.context.setManager('animation', new AnimationSystem());
        this.context.setManager('interaction', new InteractionSystem(this.context));
        this.context.setManager('vrUi', new VRUIManager(this.context));
        this.context.setManager('debugRender', new DebugRenderManager(this.context));
        this.context.setManager('particles', new ParticleSystemManager(this.context.managers.render.scene));
        this.context.setManager('social', new SocialEffectsManager(this.context, this.context.managers.particles));

        // Tracking Initialization
        const tracking = new TrackingManager(this.context);
        tracking.registerProvider(new XRTrackingProvider(this.context));
        tracking.registerProvider(new DesktopTrackingProvider(this.context));
        tracking.setProvider('desktop'); // Default
        this.context.setManager('tracking', tracking);
    }

    private setupGlobalEventListeners(): void {
        const managers = this.context.managers;

        // Audio Activation
        const resumeAudio = () => {
            managers.audio.resume();
            window.removeEventListener('pointerdown', resumeAudio);
            window.removeEventListener('keydown', resumeAudio);
        };
        window.addEventListener('pointerdown', resumeAudio);
        window.addEventListener('keydown', resumeAudio);

        // Tracking Provider Switching
        eventBus.on(EVENTS.XR_SESSION_STARTED, () => {
            managers.tracking.setProvider('xr');
        });
        eventBus.on(EVENTS.XR_SESSION_ENDED, () => {
            managers.tracking.setProvider('desktop');
        });

        // HUD/Camera integration
        if (managers.render && managers.hud) {
            managers.render.camera.add(managers.hud.group);
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
        const managers = this.context.managers;

        if (managers.render && managers.session) {
            managers.session.init(managers.render.scene);
        }

        if (managers.vrUi) {
            managers.vrUi.init();
        }
        if (managers.debugRender) {
            managers.debugRender.init();
        }

        // Register systems to GameEngine in the exact desired execution order
        if (managers.network) this.engine.addSystem(managers.network as any);
        if (managers.input) this.engine.addSystem(managers.input as any);
        if (managers.entity) this.engine.addSystem(managers.entity as any);

        // Physics needs a small wrapper because its update method is called 'step' and only takes delta
        if (managers.physics) {
            this.engine.addSystem({
                update: (delta) => managers.physics!.step(delta)
            });
        }
        this.engine.addSystem(new PhysicsPresentationSystem(this.context));

        if (managers.session) this.engine.addSystem(managers.session as any);
        if (managers.social) this.engine.addSystem(managers.social as any);
        if (managers.particles) this.engine.addSystem(managers.particles as any);
        if (managers.remoteDesktop) this.engine.addSystem(managers.remoteDesktop as any);
        if (managers.ui) this.engine.addSystem(managers.ui as any);
        if (managers.hud) this.engine.addSystem(managers.hud as any);
        if (managers.vrUi) this.engine.addSystem(managers.vrUi as any);
        if (managers.debugRender) this.engine.addSystem(managers.debugRender as any);

        if (managers.render) {
            this.engine.addSystem({
                update: (delta) => {
                    managers.render!.update(delta, this.context.localPlayer);
                    managers.render!.render();
                }
            });
        }

        // Tasks at the end of the frame
        if (managers.input) {
            this.engine.onEndFrame(() => managers.input!.clearJustPressed());
        }
    }

    private playerInitialized = false;
    private initPlayerOnce(id: string): void {
        if (this.playerInitialized || !id) return;
        this.playerInitialized = true;

        const managers = this.context.managers;
        managers.render.switchToPlayerView();

        managers.player.init(id);
    }
}
