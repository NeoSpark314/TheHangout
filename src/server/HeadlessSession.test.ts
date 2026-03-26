import { beforeEach, describe, expect, it, vi } from 'vitest';

const loopInstances: any[] = [];
const physicsInstances: any[] = [];
const sessionInstances: any[] = [];
const transportInstances: any[] = [];

vi.mock('../app/SimulationLoop', () => ({
    SimulationLoop: class {
        public addSystem = vi.fn();
        public start = vi.fn();
        public stop = vi.fn();
        constructor() {
            loopInstances.push(this);
        }
    }
}));

vi.mock('../world/entities/EntityRegistry', () => ({
    EntityRegistry: class {
        public entities = new Map([
            ['peer-a', { type: 'PLAYER_AVATAR', controlMode: 'remote', name: 'Peer A' }],
            ['prop-a', { type: 'PHYSICS_PROP' }]
        ]);
        public getEntity = vi.fn((id: string) => this.entities.get(id));
    }
}));

vi.mock('../physics/runtime/PhysicsRuntime', () => ({
    PhysicsRuntime: class {
        public init = vi.fn(async () => {});
        public step = vi.fn();
        public world = { nbRigidBodies: 3, nbColliders: 7 };
        constructor() {
            physicsInstances.push(this);
        }
    }
}));

vi.mock('../physics/runtime/PhysicsAuthorityRuntime', () => ({
    PhysicsAuthorityRuntime: class {}
}));

vi.mock('../world/session/ScenarioManager', () => ({
    ScenarioManager: class {
        public init = vi.fn();
        public update = vi.fn();
        public getAvailableScenarios = vi.fn(() => [{ id: 'default-hangout', displayName: 'Default Hangout' }]);
        constructor() {
            sessionInstances.push(this);
        }
    }
}));

vi.mock('./DedicatedSessionTransport', () => ({
    DedicatedSessionTransport: class {
        public connections = new Map([['peer-a', {}]]);
        public bytesReceived = 12;
        public bytesSent = 34;
        public setContext = vi.fn();
        public getPeerAdminStats = vi.fn(() => ({
            connectedAt: 100,
            lastMessageAt: 200,
            bytesIn: 11,
            bytesOut: 22,
            latency: { lastRttMs: 18 }
        }));
        constructor() {
            transportInstances.push(this);
        }
    }
}));

vi.mock('../network/replication/FeatureReplicationService', () => ({
    FeatureReplicationService: class {}
}));
vi.mock('../skills/DrawingSkill', () => ({ DrawingSkill: class {} }));
vi.mock('../skills/MountSkill', () => ({ MountSkill: class { public update = vi.fn(); } }));
vi.mock('../skills/InteractionSkill', () => ({ InteractionSkill: class {} }));
vi.mock('../app/diagnostics/RuntimeDiagnostics', () => ({ RuntimeDiagnostics: class {} }));
vi.mock('../network/replication/ReplicationDebugRuntime', () => ({ ReplicationDebugRuntime: class {} }));
vi.mock('../app/notifications/NotificationRuntime', () => ({ NotificationRuntime: class {} }));
vi.mock('../content/runtime/ScenarioActionRuntime', () => ({ ScenarioActionRuntime: class {} }));
vi.mock('../content/runtime/BuiltInScenarioPlugins', () => ({
    BUILT_IN_SCENARIO_PLUGINS: [],
    DEFAULT_SCENARIO_PLUGIN_ID: 'default-hangout'
}));

describe('HeadlessSession', () => {
    beforeEach(() => {
        loopInstances.length = 0;
        physicsInstances.length = 0;
        sessionInstances.length = 0;
        transportInstances.length = 0;
        vi.clearAllMocks();
    });

    it('wires dedicated-host runtime state during construction', async () => {
        const { DedicatedSessionTransport } = await import('./DedicatedSessionTransport');
        const { HeadlessSession } = await import('./HeadlessSession');
        const transport = new DedicatedSessionTransport();
        const session = new HeadlessSession('headless-test', transport as any);

        expect(session.context.isHost).toBe(true);
        expect(session.context.isDedicatedHost).toBe(true);
        expect(session.context.isLocalServer).toBe(true);
        expect(session.context.runtime.network).toBe(transport);
        expect(transportInstances[0].setContext).toHaveBeenCalledWith(session.context);
    });

    it('starts physics and scenario runtime without a render scene', async () => {
        const { DedicatedSessionTransport } = await import('./DedicatedSessionTransport');
        const { HeadlessSession } = await import('./HeadlessSession');
        const transport = new DedicatedSessionTransport();
        const session = new HeadlessSession('headless-test', transport as any);

        await session.start();

        expect(physicsInstances[0].init).toHaveBeenCalledTimes(1);
        expect(sessionInstances[0].init).toHaveBeenCalledWith(null);
        expect(loopInstances[0].start).toHaveBeenCalledTimes(1);
    });

    it('reports peer, network, scenario, and physics stats', async () => {
        const { DedicatedSessionTransport } = await import('./DedicatedSessionTransport');
        const { HeadlessSession } = await import('./HeadlessSession');
        const transport = new DedicatedSessionTransport();
        const session = new HeadlessSession('headless-test', transport as any);

        const stats = session.getStats();

        expect(stats.clients).toBe(1);
        expect(stats.network).toEqual({ in: 12, out: 34 });
        expect(stats.activeScenarioId).toBe('default-hangout');
        expect(stats.availableScenarios).toEqual([{ id: 'default-hangout', displayName: 'Default Hangout' }]);
        expect(stats.entityBreakdown.players).toBe(1);
        expect(stats.entityBreakdown.props).toBe(1);
        expect(stats.physics).toEqual({ bodies: 3, colliders: 7 });
        expect(stats.peers[0]).toMatchObject({
            id: 'peer-a',
            name: 'Peer A',
            bytesIn: 11,
            bytesOut: 22
        });
    });
});
