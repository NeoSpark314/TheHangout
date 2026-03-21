import type { EntityRegistry } from '../world/entities/EntityRegistry';
import type { PhysicsRuntime } from '../physics/runtime/PhysicsRuntime';
import type { PhysicsAuthorityRuntime } from '../physics/runtime/PhysicsAuthorityRuntime';
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
import type { DrawingRuntime } from '../content/runtime/DrawingRuntime';
import type { MountRuntime } from '../content/runtime/MountRuntime';
import type { TrackingRuntime } from '../input/providers/TrackingRuntime';
import type { VrUiRuntime } from '../ui/vr/VrUiRuntime';
import type { DebugRenderRuntime } from '../render/debug/DebugRenderRuntime';
import type { FeatureReplicationService } from '../network/replication/FeatureReplicationService';
import type { ParticleEffectSystem } from '../render/effects/ParticleEffectSystem';
import type { SocialFeature } from '../features/social/SocialFeature';
import type { RemoteDesktopFeature } from '../features/remoteDesktop/RemoteDesktopFeature';
import type { PlayerAvatarEntity } from '../world/entities/PlayerAvatarEntity';
import type { RuntimeDiagnostics } from './diagnostics/RuntimeDiagnostics';
import type { ReplicationDebugRuntime } from '../network/replication/ReplicationDebugRuntime';
import type { NotificationRuntime } from './notifications/NotificationRuntime';
import type { ScenarioActionRuntime } from '../content/runtime/ScenarioActionRuntime';
import type { WorldTransitionRuntime } from '../render/effects/WorldTransitionRuntime';
import { DEFAULT_AVATAR_COLOR, IAvatarConfig } from '../shared/contracts/IAvatar';

export interface ISessionConfig {
    activeScenarioId: string;
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
    physicsAuthority: PhysicsAuthorityRuntime;
    player: PlayerPresenceService;
    input: InputRuntime;
    hud: HudRuntime;
    session: SessionRuntime;
    audio: AudioRuntime;
    interaction: InteractionSystem;
    animation: AnimationSystem;
    assets: AssetRuntime;
    drawing: DrawingRuntime;
    mount: MountRuntime;
    tracking: TrackingRuntime;
    vrUi: VrUiRuntime;
    debugRender: DebugRenderRuntime;
    replication: FeatureReplicationService;
    particles: ParticleEffectSystem;
    social: SocialFeature;
    remoteDesktop: RemoteDesktopFeature;
    notify: NotificationRuntime;
    diagnostics: RuntimeDiagnostics;
    replicationDebug: ReplicationDebugRuntime;
    scenarioActions: ScenarioActionRuntime;
    worldTransition: WorldTransitionRuntime;
}

/**
 * AppContext acts as the central dependency injection container and state holder.
 * It makes dependencies explicit
 * and improving testability and modularity across the application.
 */
export class AppContext {
    public isHost: boolean = false;
    public isDedicatedHost: boolean = false;
    public isLocalServer: boolean = false;
    public sessionId: string | null = null;
    public playerName: string = 'Player';
    public avatarConfig: IAvatarConfig = {
        color: DEFAULT_AVATAR_COLOR,
        renderMode: 'stick',
        vrmUrl: null
    };
    public voiceEnabled: boolean = false;
    public voiceAutoEnable: boolean = true;
    public sessionConfig: ISessionConfig = {
        activeScenarioId: 'default-hangout',
        environment: 'cyber-stube',
        skyColor: '#0b0c10',
        fogNear: 5,
        fogFar: 1000,
        seed: Math.floor(Math.random() * 2147483647)
    };

    public localPlayer: PlayerAvatarEntity | null = null;
    public isMenuOpen: boolean = false;
    public ensureGameplayStarted: (() => Promise<void>) | null = null;

    private _runtime: Partial<IRuntimeRegistry> = {};

    public get runtime(): IRuntimeRegistry {
        return this._runtime as IRuntimeRegistry;
    }

    public setRuntime<K extends keyof IRuntimeRegistry>(key: K, instance: IRuntimeRegistry[K]): void {
        this._runtime[key] = instance;
    }

    public deltaTime: number = 0;
}
