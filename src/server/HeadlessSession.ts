import { AppContext } from '../app/AppContext';
import { Engine } from '../app/Engine';
import { EntityRegistry } from '../world/entities/EntityRegistry';
import { PhysicsRuntime } from '../physics/runtime/PhysicsRuntime';
import { SessionRuntime } from '../world/session/SessionRuntime';
import { DedicatedSessionTransport } from './DedicatedSessionTransport';
import { FeatureReplicationService } from '../network/replication/FeatureReplicationService';
import { DrawingRuntime } from '../content/runtime/DrawingRuntime';
import { MountRuntime } from '../content/runtime/MountRuntime';
import { EntityType } from '../shared/contracts/IEntityState';
import { RuntimeDiagnostics } from '../app/diagnostics/RuntimeDiagnostics';
import { ReplicationDebugRuntime } from '../network/replication/ReplicationDebugRuntime';
import { NotificationRuntime } from '../app/notifications/NotificationRuntime';
import { ScenarioActionRuntime } from '../content/runtime/ScenarioActionRuntime';

export class HeadlessSession {
    public context: AppContext;
    public engine: Engine;
    public network: DedicatedSessionTransport;
    public startTime: number = Date.now();

    constructor(public sessionId: string, networkTransport: DedicatedSessionTransport) {
        this.context = new AppContext();
        this.context.isHost = true;
        this.context.isDedicatedHost = true;
        this.context.isLocalServer = true;
        this.context.sessionId = sessionId;
        this.context.playerName = 'Dedicated_Server';
        this.context.voiceEnabled = false;

        this.network = networkTransport;
        this.network.setContext(this.context);

        this.context.setRuntime('diagnostics', new RuntimeDiagnostics());
        this.context.setRuntime('replicationDebug', new ReplicationDebugRuntime());
        this.context.setRuntime('notify', new NotificationRuntime());
        const entityMgr = new EntityRegistry(this.context);
        this.context.setRuntime('entity', entityMgr);
        this.context.setRuntime('replication', new FeatureReplicationService(this.context));

        const physicsMgr = new PhysicsRuntime(this.context);
        this.context.setRuntime('physics', physicsMgr);

        const sessionMgr = new SessionRuntime(this.context);
        this.context.setRuntime('session', sessionMgr);
        this.context.setRuntime('drawing', new DrawingRuntime(this.context));
        this.context.setRuntime('mount', new MountRuntime(this.context));
        this.context.setRuntime('scenarioActions', new ScenarioActionRuntime(this.context));

        this.context.setRuntime('network', this.network as any);

        this.engine = new Engine(this.context);
        this.engine.addSystem(this.network);
        this.engine.addSystem(entityMgr);
        this.engine.addSystem({
            update: (delta) => physicsMgr.step(delta)
        });
        this.engine.addSystem(sessionMgr);
        this.engine.addSystem(this.context.runtime.mount);
    }

    public async start(): Promise<void> {
        console.log(`[HeadlessSession] Initializing Session: ${this.sessionId}`);

        await this.context.runtime.physics.init();

        // Headless sessions initialize the same scenario runtime, but without a render scene.
        this.context.runtime.session.init(null);

        console.log(`[HeadlessSession] Entity List AFTER Session Init:`, Array.from(this.context.runtime.entity.entities.keys()));

        this.engine.start();
        console.log(`[HeadlessSession] Simulation Loop Started for ${this.sessionId} at 60Hz`);
    }

    public stop(): void {
        this.engine.stop();
        console.log(`[HeadlessSession] Stopped ${this.sessionId}`);
    }

    public getStats() {
        const entityMgr = this.context.runtime.entity;
        const physicsMgr = this.context.runtime.physics;
        const entities = Array.from(entityMgr.entities.values());

        const players = entities.filter(e => e.type === EntityType.PLAYER_AVATAR && (e as any).controlMode === 'remote');

        return {
            id: this.sessionId,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            clients: this.network.connections.size,
            peers: Array.from(this.network.connections.keys()).map(id => {
                const entity = entityMgr.getEntity(id);
                const peerStats = this.network.getPeerAdminStats(id);
                return {
                    id,
                    name: (entity as any)?.name || 'Connecting...',
                    connectedAt: peerStats?.connectedAt ?? null,
                    lastMessageAt: peerStats?.lastMessageAt ?? null,
                    bytesIn: peerStats?.bytesIn ?? 0,
                    bytesOut: peerStats?.bytesOut ?? 0,
                    latency: peerStats?.latency ?? null
                };
            }),
            network: {
                in: this.network.bytesReceived,
                out: this.network.bytesSent
            },
            activeScenarioId: this.context.sessionConfig.activeScenarioId,
            availableScenarios: this.context.runtime.session.getAvailableScenarios().map((scenario) => ({
                id: scenario.id,
                displayName: scenario.displayName
            })),
            entityCount: entities.length,
            entityBreakdown: {
                players: players.length,
                props: entities.filter(e => e.type === EntityType.PHYSICS_PROP).length
            },
            physics: {
                bodies: (physicsMgr as any).world?.nbRigidBodies || 0,
                colliders: (physicsMgr as any).world?.nbColliders || 0
            }
        };
    }
}
