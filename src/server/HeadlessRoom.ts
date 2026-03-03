import { AppContext } from '../app/AppContext';
import { Engine } from '../app/Engine';
import { EntityRegistry } from '../world/entities/EntityRegistry';
import { PhysicsRuntime } from '../physics/runtime/PhysicsRuntime';
import { SessionRuntime } from '../world/session/SessionRuntime';
import { ServerNetworkManager } from './ServerNetworkManager';
import { FeatureReplicationService } from '../network/replication/FeatureReplicationService';
import { DrawingFeature } from '../features/drawing/DrawingFeature';

export class HeadlessSession {
    public context: AppContext;
    public engine: Engine;
    public network: ServerNetworkManager;
    public startTime: number = Date.now();

    constructor(public sessionId: string, networkTransport: ServerNetworkManager) {
        this.context = new AppContext();
        this.context.isHost = true;
        this.context.isDedicatedHost = true;
        this.context.isLocalServer = true;
        this.context.sessionId = sessionId;
        this.context.playerName = 'Dedicated_Server';
        this.context.voiceEnabled = false;

        this.network = networkTransport;
        this.network.setContext(this.context);

        const entityMgr = new EntityRegistry(this.context);
        this.context.setManager('entity', entityMgr);
        this.context.setManager('replication', new FeatureReplicationService(this.context));

        const physicsMgr = new PhysicsRuntime(this.context);
        this.context.setManager('physics', physicsMgr);

        const sessionMgr = new SessionRuntime(this.context);
        this.context.setManager('session', sessionMgr);
        this.context.setManager('drawing', new DrawingFeature(null, this.context));

        this.context.setManager('network', this.network as any);

        this.engine = new Engine(this.context);
        this.engine.addSystem({
            update: (delta) => physicsMgr.step(delta)
        });
        this.engine.addSystem(sessionMgr);
        this.engine.addSystem(entityMgr);
        this.engine.addSystem(this.network);
    }

    public async start(): Promise<void> {
        console.log(`[HeadlessSession] Initializing Session: ${this.sessionId}`);

        await this.context.managers.physics.init();

        // Pass null for scene in headless environment
        this.context.managers.session.init(null as any);

        console.log(`[HeadlessSession] Entity List AFTER Session Init:`, Array.from(this.context.managers.entity.entities.keys()));

        this.engine.start();
        console.log(`[HeadlessSession] Simulation Loop Started for ${this.sessionId} at 60Hz`);
    }

    public stop(): void {
        this.engine.stop();
        console.log(`[HeadlessSession] Stopped ${this.sessionId}`);
    }

    public getStats() {
        const entityMgr = this.context.managers.entity;
        const physicsMgr = this.context.managers.physics;
        const entities = Array.from(entityMgr.entities.values());

        const players = entities.filter(e => e.type === 'REMOTE_PLAYER');

        return {
            id: this.sessionId,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            clients: this.network.connections.size,
            peers: Array.from(this.network.connections.keys()).map(id => {
                const entity = entityMgr.getEntity(id);
                return {
                    id,
                    name: (entity as any)?.name || 'Connecting...'
                };
            }),
            network: {
                in: this.network.bytesReceived,
                out: this.network.bytesSent
            },
            entityCount: entities.length,
            entityBreakdown: {
                players: players.length,
                props: entities.filter(e => e.type === 'PHYSICS_PROP').length
            },
            physics: {
                bodies: (physicsMgr as any).world?.nbRigidBodies || 0,
                colliders: (physicsMgr as any).world?.nbColliders || 0
            }
        };
    }
}
