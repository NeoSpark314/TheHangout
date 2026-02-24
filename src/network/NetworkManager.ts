import Peer, { DataConnection } from 'peerjs';
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS, PACKET_TYPES } from '../utils/Constants.js';
import { INetworkable } from '../interfaces/INetworkable';
import { IEntity } from '../interfaces/IEntity';

export class NetworkManager {
    private peer: Peer | null = null;
    private connections: Map<string, DataConnection> = new Map();
    private syncRate: number = 1 / 20;
    private timeSinceLastSync: number = 0;

    constructor() {
        eventBus.on(EVENTS.CREATE_ROOM, (customId: string) => this.initHost(customId));
        eventBus.on(EVENTS.JOIN_ROOM, (roomId: string) => this.initGuest(roomId));
    }

    public async initHost(customId: string): Promise<void> {
        this.peer = customId ? new Peer(customId) : new Peer();
        this.peer.on('open', (id) => {
            console.log(`[NetworkManager] Host Peer ID: ${id}`);
            (gameState as any).roomId = id;
            eventBus.emit(EVENTS.HOST_READY, id);
        });

        this.peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });
    }

    public async initGuest(hostId: string): Promise<void> {
        this.peer = new Peer();
        this.peer.on('open', (id) => {
            console.log(`[NetworkManager] Guest Peer ID: ${id}`);
            (gameState as any).roomId = hostId;
            const conn = this.peer!.connect(hostId, { reliable: true });
            this.setupConnection(conn);
        });
    }

    private setupConnection(conn: DataConnection): void {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            if ((gameState as any).isHost) {
                // Send initial snapshot
            }
        });

        conn.on('data', (data: any) => {
            this.handleData(conn.peer, data);
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, conn.peer);
        });
    }

    private handleData(senderId: string, data: any): void {
        const parsed = JSON.parse(data);
        // Dispatch to entities via EntityManager
        if (parsed.type === PACKET_TYPES.STATE_UPDATE || parsed.type === PACKET_TYPES.PLAYER_INPUT) {
            this.applyStateUpdate(parsed.payload);
        }
    }

    private applyStateUpdate(entityStates: any[]): void {
        const entityManager = (gameState as any).managers.entity;
        if (!entityManager) return;

        for (const stateData of entityStates) {
            const entity = entityManager.getEntity(stateData.id) as (IEntity & INetworkable<any>);
            if (entity && !entity.isAuthority) {
                entity.applyNetworkState(stateData.state);
            }
        }
    }

    public update(delta: number): void {
        this.timeSinceLastSync += delta;
        if (this.timeSinceLastSync >= this.syncRate) {
            this.timeSinceLastSync = 0;
            this.syncState();
        }
    }

    private syncState(): void {
        const entityManager = (gameState as any).managers.entity;
        if (!entityManager) return;

        const authoritativeStates = entityManager.getAuthoritativeStates();
        if (authoritativeStates.length === 0) return;

        if ((gameState as any).isHost) {
            this.broadcast(PACKET_TYPES.STATE_UPDATE, authoritativeStates);
        } else {
            this.sendData((gameState as any).roomId, PACKET_TYPES.PLAYER_INPUT, authoritativeStates);
        }
    }

    public sendData(targetId: string, type: string, payload: any): void {
        const conn = this.connections.get(targetId);
        if (conn && conn.open) {
            conn.send(JSON.stringify({ type, payload }));
        }
    }

    public broadcast(type: string, payload: any): void {
        const data = JSON.stringify({ type, payload });
        for (const conn of this.connections.values()) {
            if (conn.open) conn.send(data);
        }
    }
}
