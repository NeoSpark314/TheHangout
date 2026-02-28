import { GameContext } from '../core/GameState';
import { GameEngine } from '../core/GameEngine';
import { EntityManager } from '../managers/EntityManager';
import { PhysicsManager } from '../managers/PhysicsManager';
import { RoomManager } from '../managers/RoomManager';
import { ServerNetworkManager } from './ServerNetworkManager';
import { ReplicationManager } from '../managers/ReplicationManager';
import { DrawingManager } from '../managers/DrawingManager';

export class HeadlessRoom {
    public context: GameContext;
    public engine: GameEngine;
    public network: ServerNetworkManager;
    public startTime: number = Date.now();

    constructor(public roomId: string, networkTransport: ServerNetworkManager) {
        this.context = new GameContext();
        this.context.isHost = true;
        this.context.isDedicatedHost = true;
        this.context.isLocalServer = true;
        this.context.roomId = roomId;
        this.context.playerName = 'Dedicated_Server';
        this.context.voiceEnabled = false;

        this.network = networkTransport;
        this.network.setContext(this.context);

        const entityMgr = new EntityManager(this.context);
        this.context.setManager('entity', entityMgr);
        this.context.setManager('replication', new ReplicationManager(this.context));

        const physicsMgr = new PhysicsManager(this.context);
        this.context.setManager('physics', physicsMgr);

        const roomMgr = new RoomManager(this.context);
        this.context.setManager('room', roomMgr);
        this.context.setManager('drawing', new DrawingManager(null, this.context));

        this.context.setManager('network', this.network as any);

        this.engine = new GameEngine(this.context);
        this.engine.addSystem({
            update: (delta) => physicsMgr.step(delta)
        });
        this.engine.addSystem(roomMgr);
        this.engine.addSystem(entityMgr);
        this.engine.addSystem(this.network);
    }

    public async start(): Promise<void> {
        console.log(`[HeadlessRoom] Initializing Room: ${this.roomId}`);

        await this.context.managers.physics.init();

        // Pass null for scene in headless environment
        this.context.managers.room.init(null as any);

        console.log(`[HeadlessRoom] Entity List AFTER Room Init:`, Array.from(this.context.managers.entity.entities.keys()));

        this.engine.start();
        console.log(`[HeadlessRoom] Simulation Loop Started for ${this.roomId} at 60Hz`);
    }

    public stop(): void {
        this.engine.stop();
        console.log(`[HeadlessRoom] Stopped ${this.roomId}`);
    }

    public getStats() {
        const entityMgr = this.context.managers.entity;
        const physicsMgr = this.context.managers.physics;
        const entities = Array.from(entityMgr.entities.values());

        const players = entities.filter(e => e.type === 'REMOTE_PLAYER');

        return {
            id: this.roomId,
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
