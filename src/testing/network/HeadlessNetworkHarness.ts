import * as THREE from 'three';
import eventBus from '../../app/events/EventBus';
import { AppContext } from '../../app/AppContext';
import { RuntimeDiagnostics } from '../../app/diagnostics/RuntimeDiagnostics';
import { NotificationRuntime } from '../../app/notifications/NotificationRuntime';
import { InputRuntime } from '../../input/controllers/InputRuntime';
import { TrackingRuntime } from '../../input/providers/TrackingRuntime';
import type { ITrackingProvider, ITrackingState } from '../../shared/contracts/ITrackingProvider';
import { HandState } from '../../shared/types/HandState';
import { IAvatarTrackingFrame } from '../../shared/avatar/AvatarSkeleton';
import { EntityRegistry } from '../../world/entities/EntityRegistry';
import { PhysicsRuntime } from '../../physics/runtime/PhysicsRuntime';
import { PhysicsAuthorityRuntime } from '../../physics/runtime/PhysicsAuthorityRuntime';
import { ScenarioManager } from '../../world/session/ScenarioManager';
import { PlayerPresenceService } from '../../world/session/PlayerPresenceService';
import { FeatureReplicationService } from '../../network/replication/FeatureReplicationService';
import { ReplicationDebugRuntime } from '../../network/replication/ReplicationDebugRuntime';
import { ScenarioActionRuntime } from '../../content/runtime/ScenarioActionRuntime';
import { MountRuntime } from '../../content/runtime/MountRuntime';
import { DrawingRuntime } from '../../content/runtime/DrawingRuntime';
import { AnimationSystem } from '../../render/systems/AnimationSystem';
import { InteractionSystem } from '../../world/systems/InteractionSystem';
import { NetworkRuntime } from '../../network/transport/NetworkRuntime';
import { convertRawWorldQuaternionToAvatarWorldQuaternion } from '../../shared/avatar/AvatarTrackingSpace';
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import type { IObjectSpawnConfig } from '../../content/contracts/IObjectModule';
import type { IScenarioContext } from '../../content/contracts/IScenarioContext';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../content/contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../content/contracts/IScenarioPlugin';
import type { IObjectModule } from '../../content/contracts/IObjectModule';
import { ChairObject } from '../../content/objects/ChairObject';
import { GrabbableCubeObject } from '../../content/objects/GrabbableCubeObject';
import { SimpleSharedObject } from '../../content/objects/SimpleSharedObject';
import { ThrowableBallObject } from '../../content/objects/ThrowableBallObject';
import type { ISpawnedObjectInstance } from '../../content/contracts/ISpawnedObjectInstance';

let canvasContextInstalled = false;
let mockClockInstalled = false;
let mockNowMs = 0;
let originalPerformanceNow: (() => number) | null = null;
let originalDateNow: (() => number) | null = null;

function ensureMockClockInstalled(): void {
    if (mockClockInstalled) return;

    if (typeof performance !== 'undefined') {
        originalPerformanceNow = performance.now.bind(performance);
        Object.defineProperty(performance, 'now', {
            configurable: true,
            value: () => mockNowMs
        });
    }

    originalDateNow = Date.now;
    Date.now = () => Math.floor(mockNowMs);
    mockClockInstalled = true;
}

function resetMockClock(): void {
    mockNowMs = 0;
}

function advanceMockClock(deltaMs: number): void {
    mockNowMs += deltaMs;
}

function ensureCanvasContextMock(): void {
    if (canvasContextInstalled || typeof HTMLCanvasElement === 'undefined') return;

    const context = new Proxy({
        measureText: () => ({ width: 0 })
    } as Record<string, unknown>, {
        get(target, prop: string | symbol) {
            if (prop in target) return target[prop as keyof typeof target];
            return () => { };
        }
    });

    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: () => context
    });

    canvasContextInstalled = true;
}
class TestScenario implements IScenarioModule {
    public readonly id = 'network-test-scenario';
    public readonly displayName = 'Network Test Scenario';
    public readonly kind = 'minigame' as const;
    public readonly maxPlayers = 4;
    private readonly objects: IObjectModule[] = [
        new ChairObject(),
        new GrabbableCubeObject(),
        new SimpleSharedObject(),
        new ThrowableBallObject()
    ];

    public load(context: IScenarioContext, _options: IScenarioLoadOptions): void {
        if (!context.objects.get('test-chair')) {
            context.objects.spawn('chair', {
                id: 'test-chair',
                position: { x: 0, y: 0, z: 0 },
                rotationY: 0
            });
        }
        context.physics.ensureGround(12);
    }

    public unload(_context: IScenarioContext): void { }
    public update(_delta: number): void { }
    public getSpawnPoint(index: number): IScenarioSpawnPoint {
        return {
            position: { x: index * 1.5, y: 0.2, z: 0 },
            yaw: 0
        };
    }
    public getObjectModules(): IObjectModule[] {
        return this.objects;
    }
}

const TEST_SCENARIO_PLUGIN: IScenarioPlugin = {
    id: 'network-test-scenario',
    displayName: 'Network Test Scenario',
    kind: 'minigame',
    maxPlayers: 4,
    capabilities: {
        headless: true,
        usesPhysics: true,
        hasPortableObjects: true
    },
    objectModules: [
        new ChairObject(),
        new GrabbableCubeObject(),
        new SimpleSharedObject(),
        new ThrowableBallObject()
    ],
    create() {
        return new TestScenario();
    }
};

class HeadlessTrackingProvider implements ITrackingProvider {
    public readonly id = 'headless';

    constructor(private readonly context: AppContext) { }

    public init(): void { }
    public activate(): void { }
    public deactivate(): void { }
    public update(_delta: number, _frame?: XRFrame): void { }
    public destroy(): void { }

    public getState(): ITrackingState {
        const localPlayer = this.context.localPlayer;
        const origin = localPlayer?.xrOrigin.position ?? { x: 0, y: 0, z: 0 };
        const originQuat = localPlayer?.xrOrigin.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };
        const avatarOriginQuat = convertRawWorldQuaternionToAvatarWorldQuaternion(originQuat);
        const left = new HandState(-0.35);
        const right = new HandState(0.35);

        left.active = false;
        right.active = false;
        left.pose.position = { x: origin.x - 0.25, y: origin.y + 1.2, z: origin.z + 0.2 };
        right.pose.position = { x: origin.x + 0.25, y: origin.y + 1.2, z: origin.z + 0.2 };
        left.pointerPose.position = { ...left.pose.position };
        right.pointerPose.position = { ...right.pose.position };
        const trackingFrame: IAvatarTrackingFrame = {
            rootWorldPosition: { ...origin },
            rootWorldQuaternion: avatarOriginQuat,
            headWorldPose: {
                position: { x: origin.x, y: origin.y + 1.7, z: origin.z },
                quaternion: avatarOriginQuat
            },
            effectors: {},
            tracked: {
                head: true
            },
            seated: false
        };

        return {
            head: {
                pose: {
                    position: { x: origin.x, y: origin.y + 1.7, z: origin.z },
                    quaternion: { ...originQuat }
                },
                yaw: yawFromQuaternion(originQuat)
            },
            hands: {
                left,
                right
            },
            avatarTrackingFrame: trackingFrame
        };
    }
}

class MemoryConnection {
    public open = false;
    private listeners: Record<string, Array<(data?: unknown) => void>> = {};

    constructor(
        public readonly peer: string,
        private readonly deliver: (data: unknown) => void
    ) { }

    public on(eventName: string, callback: (data?: unknown) => void): void {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        this.listeners[eventName].push(callback);
    }

    public send(data: unknown): void {
        this.deliver(data);
    }

    public emitOpen(): void {
        this.open = true;
        this.emit('open');
    }

    public close(): void {
        if (!this.open) return;
        this.open = false;
        this.emit('close');
    }

    public receive(data: unknown): void {
        this.emit('data', data);
    }

    private emit(eventName: string, data?: unknown): void {
        for (const callback of this.listeners[eventName] || []) {
            callback(data);
        }
    }
}

type PeerKind = 'host' | 'guest';

class HeadlessPeerSession {
    public readonly context = new AppContext();
    public readonly network: NetworkRuntime;
    public readonly physics: PhysicsRuntime;
    public readonly session: ScenarioManager;
    public readonly playerPresence: PlayerPresenceService;
    private initialized = false;

    constructor(
        public readonly peerId: string,
        public readonly kind: PeerKind,
        hostSessionId?: string
    ) {
        ensureCanvasContextMock();
        this.context.isHost = kind === 'host';
        this.context.sessionId = kind === 'host' ? peerId : (hostSessionId || null);
        this.context.playerName = kind === 'host' ? 'Host' : 'Guest';
        this.context.avatarPoseOverride = 'none';

        this.context.setRuntime('diagnostics', new RuntimeDiagnostics());
        this.context.setRuntime('replicationDebug', new ReplicationDebugRuntime());
        this.context.setRuntime('notify', new NotificationRuntime());
        this.context.setRuntime('entity', new EntityRegistry(this.context));
        this.context.setRuntime('replication', new FeatureReplicationService(this.context));
        this.context.setRuntime('physicsAuthority', new PhysicsAuthorityRuntime(this.context));
        this.physics = new PhysicsRuntime(this.context);
        this.context.setRuntime('physics', this.physics);
        this.context.setRuntime('render', createHeadlessRenderRuntime() as any);
        this.context.setRuntime('media', createHeadlessMediaRuntime() as any);
        this.context.setRuntime('audio', createHeadlessAudioRuntime() as any);
        this.context.setRuntime('assets', createHeadlessAssetRuntime() as any);
        this.context.setRuntime('remoteDesktop', createHeadlessRemoteDesktopRuntime() as any);
        this.context.setRuntime('drawing', new DrawingRuntime(this.context));
        this.context.setRuntime('mount', new MountRuntime(this.context));
        this.context.setRuntime('animation', new AnimationSystem());
        this.context.setRuntime('interaction', new InteractionSystem(this.context));
        this.context.setRuntime('input', createHeadlessInputRuntime() as unknown as InputRuntime);
        const tracking = new TrackingRuntime(this.context);
        tracking.registerProvider(new HeadlessTrackingProvider(this.context));
        tracking.setProvider('headless');
        this.context.setRuntime('tracking', tracking);
        this.network = new NetworkRuntime(this.context);
        this.context.setRuntime('network', this.network);
        this.session = new ScenarioManager(this.context, [TEST_SCENARIO_PLUGIN], TEST_SCENARIO_PLUGIN.id);
        this.context.setRuntime('session', this.session);
        this.playerPresence = new PlayerPresenceService(this.context);
        this.context.setRuntime('player', this.playerPresence);
        this.context.setRuntime('scenarioActions', new ScenarioActionRuntime(this.context));
    }

    public async initialize(): Promise<void> {
        if (this.initialized) return;
        await this.physics.init();
        this.session.init(this.context.runtime.render.scene);
        if (this.kind === 'host') {
            this.initializeLocalPlayer();
        }
        this.initialized = true;
    }

    public initializeLocalPlayer(): void {
        if (this.context.localPlayer) return;
        this.playerPresence.init(this.peerId);
        (this.network as any).localPeerId = this.peerId;
    }

    public attachConnection(connection: MemoryConnection): void {
        (this.network as any).setupConnection(connection);
    }

    public step(delta: number): void {
        this.network.update(delta);
        this.context.runtime.entity.update(delta);
        this.physics.step(delta);
        this.session.update(delta);
        this.context.runtime.mount.update();
    }

    public spawnObject(moduleId: string, config: IObjectSpawnConfig): ISpawnedObjectInstance | null {
        return this.session.spawnObjectInstance(moduleId, config);
    }

    public getObject(instanceId: string): ISpawnedObjectInstance | undefined {
        return this.session.getObjectInstance(instanceId);
    }

    public getPhysicsProp(entityId: string): PhysicsPropEntity | null {
        const entity = this.context.runtime.entity.getEntity(entityId);
        return entity as PhysicsPropEntity | null;
    }

    public disconnect(): void {
        this.network.disconnect();
    }
}

export class HeadlessNetworkHarness {
    public readonly hostId = 'host-peer';
    public readonly host = new HeadlessPeerSession(this.hostId, 'host');
    public guest: HeadlessPeerSession | null = null;
    public guestId: string | null = null;
    private hostConnection: MemoryConnection | null = null;
    private guestConnection: MemoryConnection | null = null;

    public static async create(): Promise<HeadlessNetworkHarness> {
        const harness = new HeadlessNetworkHarness();
        await harness.initialize();
        return harness;
    }

    public static async createHostOnly(): Promise<HeadlessNetworkHarness> {
        const harness = new HeadlessNetworkHarness();
        await harness.host.initialize();
        harness.stepFrames(10);
        return harness;
    }

    private async initialize(): Promise<void> {
        await this.host.initialize();
        await this.connectGuest();
    }

    public stepFrames(count: number, delta: number = 1 / 60): void {
        for (let i = 0; i < count; i++) {
            this.host.step(delta);
            this.guest?.step(delta);
        }
    }

    public waitUntil(predicate: () => boolean, maxFrames: number = 240, delta: number = 1 / 60): void {
        for (let i = 0; i < maxFrames; i++) {
            if (predicate()) return;
            this.stepFrames(1, delta);
        }
        throw new Error('Condition not reached within allotted frames.');
    }

    public spawnHostObject(moduleId: string, config: IObjectSpawnConfig): ISpawnedObjectInstance {
        const instance = this.host.spawnObject(moduleId, config);
        if (!instance) {
            throw new Error(`Failed to spawn host object module: ${moduleId}`);
        }

        const primary = instance.getPrimaryEntity?.();
        if (primary) {
            this.host.network.syncEntityNow(primary.id, true);
        }
        return instance;
    }

    public requireGuest(): HeadlessPeerSession {
        if (!this.guest) {
            throw new Error('Guest session is not connected.');
        }
        return this.guest;
    }

    public async connectGuest(peerId: string = 'guest-peer'): Promise<HeadlessPeerSession> {
        if (this.guest) {
            throw new Error('Guest session is already connected.');
        }

        const guest = new HeadlessPeerSession(peerId, 'guest', this.hostId);
        await guest.initialize();

        this.guestId = peerId;
        this.hostConnection = new MemoryConnection(peerId, (data) => this.guestConnection?.receive(data));
        this.guestConnection = new MemoryConnection(this.hostId, (data) => this.hostConnection?.receive(data));

        this.host.attachConnection(this.hostConnection);
        guest.attachConnection(this.guestConnection);

        this.guest = guest;
        this.hostConnection.emitOpen();
        this.guestConnection.emitOpen();
        guest.initializeLocalPlayer();
        this.stepFrames(10);
        return guest;
    }

    public disconnectGuest(): void {
        this.guestConnection?.close();
        this.hostConnection?.close();
        this.guest?.disconnect();
        this.guest = null;
        this.guestId = null;
        this.guestConnection = null;
        this.hostConnection = null;
        this.stepFrames(2);
    }

    public reset(): void {
        this.host.disconnect();
        this.guest?.disconnect();
        const storage = (globalThis as { localStorage?: { clear?: () => void } }).localStorage;
        storage?.clear?.();
        eventBus.reset();
    }
}

function createHeadlessRenderRuntime(): Record<string, unknown> {
    const scene = new THREE.Scene();
    const interactionGroup = new THREE.Group();
    const cameraGroup = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 100);
    scene.add(interactionGroup);
    scene.add(cameraGroup);
    cameraGroup.add(camera);

    return {
        scene,
        interactionGroup,
        cameraGroup,
        camera,
        renderer: {
            domElement: document.createElement('canvas')
        },
        isXRPresenting: () => false,
        update: () => { },
        render: () => { }
    };
}

function createHeadlessInputRuntime(): Record<string, unknown> {
    return {
        processInteractions: () => { },
        clearJustPressed: () => { },
        pulseUiHover: () => { }
    };
}

function createHeadlessAudioRuntime(): Record<string, unknown> {
    return {
        playDrumPadHit: () => { },
        playSequencerBeat: () => { },
        playMelodyNote: () => { },
        playArpNote: () => { },
        playFxSweep: () => { }
    };
}

function createHeadlessMediaRuntime(): Record<string, unknown> {
    return {
        bindPeer: () => { },
        bindWebSocket: () => { },
        getRemoteStream: () => null,
        getLocalVolume: () => 0,
        isMicrophoneEnabled: () => false
    };
}

function createHeadlessAssetRuntime(): Record<string, unknown> {
    return {
        getNormalizedModel: async () => new THREE.Group(),
        loadTexture: async () => new THREE.Texture()
    };
}

function createHeadlessRemoteDesktopRuntime(): Record<string, unknown> {
    return {
        loadConfigsFromStorage: () => { },
        handleSourcesStatus: () => { },
        handleStreamSummoned: () => { },
        handleStreamStopped: () => { },
        handleStreamOffline: () => { },
        handleStreamFrame: () => { },
        handleBinaryFrame: () => { },
        update: () => { }
    };
}

function yawFromQuaternion(quaternion: { x: number; y: number; z: number; w: number }): number {
    const euler = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
        'YXZ'
    );
    return euler.y;
}

