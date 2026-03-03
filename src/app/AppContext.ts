import type { EntityRegistry } from '../world/entities/EntityRegistry';
import type { PhysicsRuntime } from '../physics/runtime/PhysicsRuntime';
import type { NetworkRuntime } from '../network/transport/NetworkRuntime';
import type { InputRuntime } from '../input/controllers/InputRuntime';
import type { RenderRuntime } from '../render/runtime/RenderRuntime';
import type { PlayerPresenceService } from '../world/session/PlayerPresenceService';
import type { SessionRuntime } from '../world/session/SessionRuntime';
import type { FlatUiRuntime } from '../ui/flat/FlatUiRuntime';
import type { HudRuntime } from '../ui/hud/HudRuntime';
import type { VoiceRuntime } from '../media/voice/VoiceRuntime';
import type { AudioRuntime } from '../media/audio/AudioRuntime';
import type { InteractionSystem } from '../world/systems/InteractionSystem';
import type { AnimationSystem } from '../render/systems/AnimationSystem';
import type { AssetRuntime } from '../assets/runtime/AssetRuntime';
import type { DrawingFeature } from '../features/drawing/DrawingFeature';
import type { TrackingRuntime } from '../input/providers/TrackingRuntime';
import type { VrUiRuntime } from '../ui/vr/VrUiRuntime';
import type { DebugRenderRuntime } from '../render/debug/DebugRenderRuntime';
import type { FeatureReplicationService } from '../network/replication/FeatureReplicationService';
import type { ParticleEffectSystem } from '../render/effects/ParticleEffectSystem';
import type { SocialFeature } from '../features/social/SocialFeature';
import type { RemoteDesktopFeature } from '../features/remoteDesktop/RemoteDesktopFeature';
import type { PlayerAvatarEntity } from '../world/entities/PlayerAvatarEntity';

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

export interface IRuntimeRegistry {
    entity: EntityRegistry;
    ui: FlatUiRuntime;
    network: NetworkRuntime;
    media: VoiceRuntime;
    render: RenderRuntime;
    physics: PhysicsRuntime;
    player: PlayerPresenceService;
    input: InputRuntime;
    hud: HudRuntime;
    session: SessionRuntime;
    audio: AudioRuntime;
    interaction: InteractionSystem;
    animation: AnimationSystem;
    assets: AssetRuntime;
    drawing: DrawingFeature;
    tracking: TrackingRuntime;
    vrUi: VrUiRuntime;
    debugRender: DebugRenderRuntime;
    replication: FeatureReplicationService;
    particles: ParticleEffectSystem;
    social: SocialFeature;
    remoteDesktop: RemoteDesktopFeature;
}

/**
 * AppContext acts as the central dependency injection container and state holder.
 * It replaces the legacy global singleton approach, making dependencies explicit
 * and improving testability and modularity across the application.
 */
export class AppContext {
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

    public localPlayer: PlayerAvatarEntity | null = null;
    public isMenuOpen: boolean = false;

    private _runtime: Partial<IRuntimeRegistry> = {};

    public get runtime(): IRuntimeRegistry {
        return this._runtime as IRuntimeRegistry;
    }

    public setRuntime<K extends keyof IRuntimeRegistry>(key: K, instance: IRuntimeRegistry[K]): void {
        this._runtime[key] = instance;
    }

    public deltaTime: number = 0;
}
