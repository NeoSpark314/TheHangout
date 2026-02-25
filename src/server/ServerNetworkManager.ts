import { GameContext } from '../core/GameState';
import { IUpdatable } from '../interfaces/IUpdatable';
import { PACKET_TYPES } from '../utils/Constants';
import { NetworkDispatcher } from '../network/NetworkDispatcher';
import { NetworkSynchronizer, INetworkTransport } from '../network/NetworkSynchronizer';
import { IStateUpdatePacket, EntityType } from '../interfaces/IEntityState';

export class ServerNetworkManager implements IUpdatable, INetworkTransport {
    private context!: GameContext;
    private dispatcher: NetworkDispatcher;
    private synchronizer!: NetworkSynchronizer;
    public connections: Map<string, any> = new Map(); // peerId -> WebSocket

    constructor() {
        this.dispatcher = new NetworkDispatcher();
    }

    public setContext(context: GameContext): void {
        this.context = context;
        this.synchronizer = new NetworkSynchronizer(this, this.context);

        // Register server handlers
        this.dispatcher.registerHandler(PACKET_TYPES.PLAYER_INPUT, {
            handle: (senderId: string, payload: IStateUpdatePacket[]) => {
                this.applyStateUpdate(payload);
                // Headless server broadcasts its own authoritative state via synchronizer.
                // Re-broadcasting raw inputs causes rubber-banding and duplication conflicts BUT
                // we must relay avatars so clients can see each other's LOCAL_PLAYER updates!
                const avatarPackets = payload.filter(p => p.type === EntityType.LOCAL_PLAYER);
                if (avatarPackets.length > 0) {
                    this.relayToOthers(senderId, PACKET_TYPES.PLAYER_INPUT, avatarPackets);
                }
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_REQUEST, {
            handle: (senderId: string, payload: { entityId: string }) => {
                this.handleOwnershipRequest(senderId, payload);
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.OWNERSHIP_RELEASE, {
            handle: (senderId: string, payload: { entityId: string, newOwnerId: string }) => {
                this.handleOwnershipRelease(senderId, payload);
            }
        });

        this.dispatcher.registerHandler(PACKET_TYPES.DRAW_LINE_SEGMENT, {
            handle: (senderId: string, payload: any) => {
                this.relayToOthers(senderId, PACKET_TYPES.DRAW_LINE_SEGMENT, payload);
            }
        });
    }

    public update(delta: number): void {
        if (this.synchronizer) {
            this.synchronizer.update(delta);
        }
    }

    public addClient(peerId: string, ws: any): void {
        this.connections.set(peerId, ws);

        const welcomeConfig = { ...this.context.roomConfig, assignedSpawnIndex: this.connections.size };
        this.sendData(peerId, PACKET_TYPES.ROOM_CONFIG_UPDATE, welcomeConfig);

        const snapshot = this.context.managers.entity.getWorldSnapshot();
        this.sendData(peerId, PACKET_TYPES.STATE_UPDATE, snapshot);
    }

    public removeClient(peerId: string): void {
        this.connections.delete(peerId);
        this.reclaimOwnership(peerId);
        if (this.context.managers.entity) {
            this.context.managers.entity.removeEntity(peerId);
        }
        this.broadcast(PACKET_TYPES.PEER_DISCONNECT, peerId);
    }

    public handleMessage(peerId: string, messageData: any): void {
        if (messageData.type === PACKET_TYPES.AUDIO_CHUNK) {
            this.relayToOthers(peerId, PACKET_TYPES.AUDIO_CHUNK, messageData.payload);
            return;
        }
        this.dispatcher.dispatch(peerId, messageData);
    }

    // --- INetworkTransport implementation ---
    public sendData(targetId: string, type: number, payload: unknown): void {
        const ws = this.connections.get(targetId);
        if (ws && ws.readyState === 1) { // 1 = OPEN
            ws.send(JSON.stringify({ type, payload }));
        }
    }

    public broadcast(type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload });
        for (const ws of this.connections.values()) {
            if (ws?.readyState === 1) ws.send(data);
        }
    }

    public relayToOthers(senderId: string, type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload, senderId }); // Inject senderId to identify source
        for (const [peerId, ws] of this.connections.entries()) {
            if (peerId !== senderId && ws?.readyState === 1) {
                ws.send(data);
            }
        }
    }

    // --- State and Ownership Methods ---
    public applyStateUpdate(entityStates: IStateUpdatePacket[]): void {
        const managers = this.context.managers;
        for (const stateData of entityStates) {
            let entity = managers.entity.getEntity(stateData.id);
            if (!entity) {
                const spawnType = stateData.type === EntityType.LOCAL_PLAYER ? EntityType.REMOTE_PLAYER : stateData.type;
                const config = { spawnPos: { x: 0, y: 0, z: 0 }, spawnYaw: 0, isAuthority: false };
                entity = managers.entity.discover(stateData.id, spawnType, config) || undefined;
            }
            if (entity && !entity.isAuthority) {
                const networkable = entity as any;
                if (networkable.applyNetworkState) networkable.applyNetworkState(stateData.state);
            }
        }
    }

    public reclaimOwnership(peerId: string): void {
        for (const entity of this.context.managers.entity.entities.values()) {
            const logicEntity = entity as any;
            if (logicEntity.ownerId === peerId) {
                logicEntity.ownerId = null;
                entity.isAuthority = true;
                this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: null });
            }
        }
    }

    public handleOwnershipRequest(senderId: string, payload: { entityId: string }): void {
        const entity = this.context.managers.entity.getEntity(payload.entityId);
        if (!entity) return;
        const logicEntity = entity as any;
        if (!logicEntity.ownerId || logicEntity.ownerId === senderId) {
            logicEntity.ownerId = senderId;
            entity.isAuthority = false; // Server gives up authority
            this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: senderId });
        }
    }

    public handleOwnershipRelease(senderId: string, payload: { entityId: string }): void {
        const entity = this.context.managers.entity.getEntity(payload.entityId);
        if (!entity) return;
        const logicEntity = entity as any;
        if (logicEntity.ownerId !== senderId) return;

        logicEntity.ownerId = null;
        entity.isAuthority = true; // Server reclaims authority

        if (logicEntity.onNetworkEvent) {
            logicEntity.onNetworkEvent('OWNERSHIP_RELEASE', payload);
        }

        this.broadcast(PACKET_TYPES.OWNERSHIP_TRANSFER, { entityId: entity.id, newOwnerId: null });
    }
}
