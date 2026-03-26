import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import eventBus from './events/EventBus';
import { EVENTS } from '../shared/constants/Constants';

const configRegisterSpy = vi.fn();
const builtInPlugins = [{ id: 'default-hangout', displayName: 'Default Hangout', create: vi.fn() }];
const simulationLoopInstances: any[] = [];
const renderInstances: any[] = [];
const physicsInstances: any[] = [];
const sessionInstances: any[] = [];
const playerInstances: any[] = [];
const vrUiInstances: any[] = [];
const debugRenderInstances: any[] = [];
const animationInstances: any[] = [];
const trackingInstances: any[] = [];

vi.mock('./SimulationLoop', () => ({
    SimulationLoop: class {
        public addSystem = vi.fn();
        public onEndFrame = vi.fn();
        public initialize = vi.fn(async () => {});
        public start = vi.fn();
        constructor(public context: unknown) {
            simulationLoopInstances.push(this);
        }
    }
}));

vi.mock('../ui/flat/FlatUiRuntime', () => ({
    FlatUiRuntime: class {
        public update = vi.fn();
        public handleControllerCursor = vi.fn();
    }
}));

vi.mock('../ui/MenuRuntime', () => ({
    MenuRuntime: class {
        public close = vi.fn();
    }
}));

vi.mock('../network/transport/NetworkRuntime', () => ({
    NetworkRuntime: class {
        public update = vi.fn();
        public peer = null;
        public localPeerId = null;
    }
}));

vi.mock('../physics/runtime/PhysicsRuntime', () => ({
    PhysicsRuntime: class {
        public init = vi.fn(async () => {});
        public step = vi.fn();
        constructor() {
            physicsInstances.push(this);
        }
    }
}));

vi.mock('../physics/runtime/PhysicsAuthorityRuntime', () => ({
    PhysicsAuthorityRuntime: class {}
}));

vi.mock('../render/runtime/RenderRuntime', () => ({
    RenderRuntime: class {
        public scene = { tag: 'scene' };
        public camera = { add: vi.fn() };
        public renderer = { domElement: document.createElement('canvas') };
        public update = vi.fn();
        public render = vi.fn();
        public isXRPresenting = vi.fn(() => false);
        public switchToPlayerView = vi.fn();
        constructor() {
            renderInstances.push(this);
        }
    }
}));

vi.mock('../world/session/PlayerPresenceService', () => ({
    PlayerPresenceService: class {
        public init = vi.fn();
        constructor() {
            playerInstances.push(this);
        }
    }
}));

vi.mock('../world/entities/EntityRegistry', () => ({
    EntityRegistry: class {
        public update = vi.fn();
        public entities = new Map();
        public getEntity = vi.fn();
    }
}));

vi.mock('../media/voice/VoiceRuntime', () => ({
    VoiceRuntime: class {}
}));

vi.mock('../ui/hud/HudRuntime', () => ({
    HudRuntime: class {
        public group = {};
        public update = vi.fn();
    }
}));

vi.mock('../input/controllers/InputRuntime', () => ({
    InputRuntime: class {
        public update = vi.fn();
        public clearJustPressed = vi.fn();
    }
}));

vi.mock('../world/session/ScenarioManager', () => ({
    ScenarioManager: class {
        public update = vi.fn();
        public assignedSpawnIndex = 0;
        public init = vi.fn();
        constructor(public context: unknown, public plugins: unknown, public defaultScenarioId: string) {
            sessionInstances.push(this);
        }
    }
}));

vi.mock('../media/audio/AudioRuntime', () => ({
    AudioRuntime: class {
        public resume = vi.fn();
    }
}));

vi.mock('../skills/InteractionSkill', () => ({
    InteractionSkill: class {}
}));

vi.mock('../assets/runtime/AssetRuntime', () => ({
    AssetRuntime: class {}
}));

vi.mock('../skills/DrawingSkill', () => ({
    DrawingSkill: class {}
}));

vi.mock('../skills/MountSkill', () => ({
    MountSkill: class {}
}));

vi.mock('../input/providers/TrackingRuntime', () => ({
    TrackingRuntime: class {
        public registerProvider = vi.fn();
        public setProvider = vi.fn();
        constructor() {
            trackingInstances.push(this);
        }
    }
}));

vi.mock('../input/providers/XRTrackingProvider', () => ({
    XRTrackingProvider: class {
        public id = 'xr';
    }
}));

vi.mock('../input/providers/DesktopTrackingProvider', () => ({
    DesktopTrackingProvider: class {
        public id = 'desktop';
    }
}));

vi.mock('../render/systems/AnimationSystem', () => ({
    AnimationSystem: class {
        public clearLocalPlayer = vi.fn();
        constructor() {
            animationInstances.push(this);
        }
    }
}));

vi.mock('../physics/systems/PhysicsPresentationSystem', () => ({
    PhysicsPresentationSystem: class {
        public update = vi.fn();
    }
}));

vi.mock('../ui/vr/VrUiRuntime', () => ({
    VrUiRuntime: class {
        public init = vi.fn();
        public update = vi.fn();
        public handleControllerCursor = vi.fn();
        constructor() {
            vrUiInstances.push(this);
        }
    }
}));

vi.mock('../render/debug/DebugRenderRuntime', () => ({
    DebugRenderRuntime: class {
        public init = vi.fn();
        public update = vi.fn();
        constructor() {
            debugRenderInstances.push(this);
        }
    }
}));

vi.mock('../network/replication/FeatureReplicationService', () => ({
    FeatureReplicationService: class {}
}));

vi.mock('../render/effects/ParticleEffectSystem', () => ({
    ParticleEffectSystem: class {
        public update = vi.fn();
    }
}));

vi.mock('../render/effects/WorldTransitionRuntime', () => ({
    WorldTransitionRuntime: class {
        public update = vi.fn();
    }
}));

vi.mock('../features/social/SocialFeature', () => ({
    SocialFeature: class {
        public update = vi.fn();
    }
}));

vi.mock('../features/remoteDesktop/RemoteDesktopFeature', () => ({
    RemoteDesktopFeature: class {
        public update = vi.fn();
    }
}));

vi.mock('./diagnostics/RuntimeDiagnostics', () => ({
    RuntimeDiagnostics: class {
        public record = vi.fn();
    }
}));

vi.mock('../network/replication/ReplicationDebugRuntime', () => ({
    ReplicationDebugRuntime: class {
        public setMode = vi.fn();
        public setFeatureFilter = vi.fn();
        public getFeatureFilter = vi.fn(() => null);
        public clear = vi.fn();
        public listFeatureStats = vi.fn(() => []);
        public getRecentTraces = vi.fn(() => []);
    }
}));

vi.mock('./notifications/NotificationRuntime', () => ({
    NotificationRuntime: class {}
}));

vi.mock('../assets/procedural/EnvironmentBuilder', () => ({
    EnvironmentBuilder: class {
        public applyConfig = vi.fn();
        public clearProcedural = vi.fn();
        public update = vi.fn();
    }
}));

vi.mock('../content/runtime/ScenarioActionRuntime', () => ({
    ScenarioActionRuntime: class {}
}));

vi.mock('../content/runtime/BuiltInScenarioPlugins', () => ({
    BUILT_IN_SCENARIO_PLUGINS: builtInPlugins,
    DEFAULT_SCENARIO_PLUGIN_ID: 'default-hangout'
}));

vi.mock('../shared/config/ConfigRegistry', () => ({
    ConfigRegistry: {
        register: configRegisterSpy
    }
}));

vi.mock('../world/entities/LocalPlayerLateUpdateSystem', () => ({
    LocalPlayerLateUpdateSystem: class {
        public update = vi.fn();
    }
}));

describe('Engine', () => {
    beforeEach(() => {
        eventBus.reset();
        vi.clearAllMocks();
        simulationLoopInstances.length = 0;
        renderInstances.length = 0;
        physicsInstances.length = 0;
        sessionInstances.length = 0;
        playerInstances.length = 0;
        vrUiInstances.length = 0;
        debugRenderInstances.length = 0;
        animationInstances.length = 0;
        trackingInstances.length = 0;
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            json: async () => ({})
        })));
    });

    afterEach(() => {
        eventBus.reset();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers the expected core runtimes during bootstrap', async () => {
        const { Engine } = await import('./Engine');
        const engine = new Engine();

        await engine.bootstrap();

        expect(configRegisterSpy).toHaveBeenCalledWith(expect.objectContaining({
            id: 'user_items'
        }));
        expect(engine.context.runtime.flatUi).toBeTruthy();
        expect(engine.context.runtime.network).toBeTruthy();
        expect(engine.context.runtime.render).toBeTruthy();
        expect(engine.context.runtime.physics).toBeTruthy();
        expect(engine.context.runtime.session).toBeTruthy();
        expect(engine.context.runtime.menu).toBeTruthy();
        expect(engine.context.runtime.tracking).toBeTruthy();
        expect(trackingInstances[0].registerProvider).toHaveBeenCalledTimes(2);
        expect(trackingInstances[0].setProvider).toHaveBeenCalledWith('desktop');
    });

    it('bootstraps the loop and emits SCENE_READY', async () => {
        const { Engine } = await import('./Engine');
        const engine = new Engine();
        const readyEvents: number[] = [];
        eventBus.on(EVENTS.SCENE_READY, () => readyEvents.push(1));

        await engine.bootstrap();

        expect(simulationLoopInstances[0].initialize).toHaveBeenCalledTimes(1);
        expect(simulationLoopInstances[0].start).toHaveBeenCalledTimes(1);
        expect(readyEvents).toHaveLength(1);
        expect(renderInstances[0].camera.add).toHaveBeenCalled();
    });

    it('starts gameplay runtimes only once', async () => {
        const { Engine } = await import('./Engine');
        const engine = new Engine();
        await engine.bootstrap();

        await engine.context.ensureGameplayStarted?.();
        await engine.context.ensureGameplayStarted?.();

        expect(physicsInstances[0].init).toHaveBeenCalledTimes(1);
        expect(sessionInstances[0].init).toHaveBeenCalledWith(renderInstances[0].scene);
        expect(sessionInstances[0].init).toHaveBeenCalledTimes(1);
        expect(vrUiInstances[0].init).toHaveBeenCalledTimes(1);
        expect(debugRenderInstances[0].init).toHaveBeenCalledTimes(1);
    });

    it('waits for assignedSpawnIndex before initializing a guest player', async () => {
        const { Engine } = await import('./Engine');
        const engine = new Engine();
        engine.context.isHost = false;
        await engine.bootstrap();
        sessionInstances[0].assignedSpawnIndex = undefined;

        eventBus.emit(EVENTS.SESSION_CONNECTED, 'guest-1');
        expect(playerInstances[0].init).not.toHaveBeenCalled();
        expect(renderInstances[0].switchToPlayerView).not.toHaveBeenCalled();

        sessionInstances[0].assignedSpawnIndex = 1;
        eventBus.emit(EVENTS.SESSION_CONNECTED, 'guest-1');

        expect(renderInstances[0].switchToPlayerView).toHaveBeenCalledTimes(1);
        expect(playerInstances[0].init).toHaveBeenCalledWith('guest-1');
    });

    it('clears local player state on SESSION_LEFT', async () => {
        const { Engine } = await import('./Engine');
        const engine = new Engine();
        await engine.bootstrap();
        engine.context.localPlayer = { id: 'player-1' } as any;

        eventBus.emit(EVENTS.SESSION_LEFT);

        expect(engine.context.localPlayer).toBeNull();
        expect(animationInstances[0].clearLocalPlayer).toHaveBeenCalledTimes(1);
    });
});
