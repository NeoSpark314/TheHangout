import type { EntityRegistry } from '../world/entities/EntityRegistry';
import type { PhysicsRuntime } from '../physics/runtime/PhysicsRuntime';
import type { PhysicsAuthorityRuntime } from '../physics/runtime/PhysicsAuthorityRuntime';
import type { NetworkRuntime } from '../network/transport/NetworkRuntime';
import type { InputRuntime } from '../input/controllers/InputRuntime';
import type { RenderRuntime } from '../render/runtime/RenderRuntime';
import type { PlayerPresenceService } from '../world/session/PlayerPresenceService';
import type { ScenarioManager } from '../world/session/ScenarioManager';
import type { FlatUiRuntime } from '../ui/flat/FlatUiRuntime';
import type { HudRuntime } from '../ui/hud/HudRuntime';
import type { VoiceRuntime } from '../media/voice/VoiceRuntime';
import type { AudioRuntime } from '../media/audio/AudioRuntime';
import type { InteractionSkill } from '../skills/InteractionSkill';
import type { AnimationSystem } from '../render/systems/AnimationSystem';
import type { AssetRuntime } from '../assets/runtime/AssetRuntime';
import type { DrawingSkill } from '../skills/DrawingSkill';
import type { MountSkill } from '../skills/MountSkill';
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
import { AvatarRenderMode, DEFAULT_AVATAR_COLOR, IAvatarConfig } from '../shared/contracts/IAvatar';

export interface IScenarioConfig {
    environment?: string;
    skyColor?: string;
    fogNear?: number;
    fogFar?: number;
    [key: string]: any;
}

export interface ISessionConfig {
    activeScenarioId: string;
    seed: number;
    scenarioConfig?: IScenarioConfig;
}

export type AvatarPoseOverride = 'none' | 'vrm-tpose';

export interface IEngineRuntime {
    entity: EntityRegistry;
    ui: FlatUiRuntime;
    network: NetworkRuntime;
    media: VoiceRuntime;
    render: RenderRuntime;
    physics: PhysicsRuntime;
    physicsAuthority: PhysicsAuthorityRuntime;
    input: InputRuntime;
    hud: HudRuntime;
    audio: AudioRuntime;
    assets: AssetRuntime;
    animation: AnimationSystem;
    tracking: TrackingRuntime;
    debugRender: DebugRenderRuntime;
    replication: FeatureReplicationService;
    particles: ParticleEffectSystem;
    notify: NotificationRuntime;
    diagnostics: RuntimeDiagnostics;
    replicationDebug: ReplicationDebugRuntime;
}

export interface ISkillsRuntime {
    interaction: InteractionSkill;
    drawing: DrawingSkill;
    mount: MountSkill;
}

export interface IGameSessionRuntime {
    player: PlayerPresenceService;
    session: ScenarioManager;
    skills: ISkillsRuntime;
    vrUi: VrUiRuntime;
    social: SocialFeature;
    remoteDesktop: RemoteDesktopFeature;
    scenarioActions: ScenarioActionRuntime;
    worldTransition: WorldTransitionRuntime;
}

export interface IRuntimeRegistry extends IEngineRuntime, IGameSessionRuntime {}

export interface IEngineContext {
    isHost: boolean;
    isDedicatedHost: boolean;
    isLocalServer: boolean;
    sessionId: string | null;
    voiceEnabled: boolean;
    voiceAutoEnable: boolean;
    deltaTime: number;
    readonly runtime: IRuntimeRegistry;
}

export interface IGameSessionContext {
    playerName: string;
    avatarConfig: IAvatarConfig;
    avatarRenderOverride: AvatarRenderMode | null;
    avatarPoseOverride: AvatarPoseOverride;
    renderLocalAvatar: boolean;
    showTrackedInputGhost: boolean;
    sessionConfig: ISessionConfig;
    localPlayer: PlayerAvatarEntity | null;
    isMenuOpen: boolean;
    ensureGameplayStarted: (() => Promise<void>) | null;
}

/**
 * AppContext acts as the central dependency injection container and state holder.
 * It makes dependencies explicit
 * and improving testability and modularity across the application.
 */
export class AppContext implements IEngineContext, IGameSessionContext {
    public isHost: boolean = false;
    public isDedicatedHost: boolean = false;
    public isLocalServer: boolean = false;
    public sessionId: string | null = null;
    public playerName: string = 'Player';
    public avatarConfig: IAvatarConfig = {
        color: DEFAULT_AVATAR_COLOR,
        renderMode: 'stick',
        vrmUrl: null,
        playerHeightM: 1.8
    };
    public avatarRenderOverride: AvatarRenderMode | null = null;
    public avatarPoseOverride: AvatarPoseOverride = 'none';
    public renderLocalAvatar: boolean = true;
    public showTrackedInputGhost: boolean = true;
    public voiceEnabled: boolean = false;
    public voiceAutoEnable: boolean = true;
    public sessionConfig: ISessionConfig = {
        activeScenarioId: 'default-hangout',
        seed: Math.floor(Math.random() * 2147483647),
        scenarioConfig: {
            environment: 'cyber-stube',
            skyColor: '#0b0c10',
            fogNear: 5,
            fogFar: 1000
        }
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
