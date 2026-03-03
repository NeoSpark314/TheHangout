import type { EntityManager } from '../world/entities/EntityRegistry';
import type { PhysicsManager } from '../physics/runtime/PhysicsRuntime';
import type { NetworkManager } from '../network/transport/NetworkRuntime';
import type { InputManager } from '../input/controllers/InputRuntime';
import type { RenderManager } from '../render/runtime/RenderRuntime';
import type { PlayerManager } from '../world/session/PlayerPresenceService';
import type { SessionManager } from '../world/session/SessionRuntime';
import type { FlatUIManager } from '../ui/flat/FlatUiRuntime';
import type { HUDManager } from '../ui/hud/HudRuntime';
import type { MediaManager } from '../media/voice/VoiceRuntime';
import type { AudioManager } from '../media/audio/AudioRuntime';
import type { InteractionSystem } from '../world/systems/InteractionSystem';
import type { AnimationSystem } from '../render/systems/AnimationSystem';
import type { AssetManager } from '../assets/runtime/AssetRuntime';
import type { DrawingManager } from '../features/drawing/DrawingFeature';
import type { TrackingManager } from '../input/providers/TrackingRuntime';
import type { VRUIManager } from '../ui/vr/VrUiRuntime';
import type { DebugRenderManager } from '../render/debug/DebugRenderRuntime';
import type { ReplicationManager } from '../network/replication/FeatureReplicationService';
import type { ParticleSystemManager } from '../render/effects/ParticleEffectSystem';
import type { SocialEffectsManager } from '../features/social/SocialFeature';
import type { RemoteDesktopManager } from '../features/remoteDesktop/RemoteDesktopFeature';
import type { LocalPlayer } from '../world/entities/LocalPlayer';

export interface IAvatarConfig {
    color: string | number;
}

export interface ISessionConfig {
    environment: string;
    skyColor: string;
    fogNear: number;
    fogFar: number;
    seed: number;
}

export interface IManagers {
    entity: EntityManager;
    ui: FlatUIManager;
    network: NetworkManager;
    media: MediaManager;
    render: RenderManager;
    physics: PhysicsManager;
    player: PlayerManager;
    input: InputManager;
    hud: HUDManager;
    session: SessionManager;
    audio: AudioManager;
    interaction: InteractionSystem;
    animation: AnimationSystem;
    assets: AssetManager;
    drawing: DrawingManager;
    tracking: TrackingManager;
    vrUi: VRUIManager;
    debugRender: DebugRenderManager;
    replication: ReplicationManager;
    particles: ParticleSystemManager;
    social: SocialEffectsManager;
    remoteDesktop: RemoteDesktopManager;
}

/**
 * GameContext acts as the central dependency injection container and state holder.
 * It replaces the legacy global singleton approach, making dependencies explicit
 * and improving testability and modularity across the application.
 */
export class GameContext {
    public isHost: boolean = false;
    public isDedicatedHost: boolean = false;
    public isLocalServer: boolean = false;
    public sessionId: string | null = null;
    public playerName: string = 'Player';
    public avatarConfig: IAvatarConfig = {
        color: '#00ffff'
    };
    public voiceEnabled: boolean = false;
    public voiceAutoEnable: boolean = true;
    public sessionConfig: ISessionConfig = {
        environment: 'cyber-stube',
        skyColor: '#0b0c10',
        fogNear: 5,
        fogFar: 1000,
        seed: Math.floor(Math.random() * 2147483647)
    };

    public localPlayer: LocalPlayer | null = null;
    public isMenuOpen: boolean = false;

    private _managers: Partial<IManagers> = {};

    public get managers(): IManagers {
        return this._managers as IManagers;
    }

    public setManager<K extends keyof IManagers>(key: K, instance: IManagers[K]): void {
        this._managers[key] = instance;
    }

    public deltaTime: number = 0;
}
