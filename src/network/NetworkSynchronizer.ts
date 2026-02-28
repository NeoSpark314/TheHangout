import { GameContext } from '../core/GameState';
import { PACKET_TYPES } from '../utils/Constants';

export interface INetworkTransport {
    broadcast(type: number, payload: any): void;
    sendData(targetId: string, type: number, payload: any): void;
}

export class NetworkSynchronizer {
    private transport: INetworkTransport;
    private syncRate: number = 1 / 20;
    private heartbeatRate: number = 2.0;
    private timeSinceLastSync: number = 0;
    private timeSinceLastHeartbeat: number = 0;

    constructor(transport: INetworkTransport, private context: GameContext) {
        this.transport = transport;
    }

    public update(delta: number): void {
        this.timeSinceLastSync += delta;
        this.timeSinceLastHeartbeat += delta;

        const needsSync = this.timeSinceLastSync >= this.syncRate;
        const needsHeartbeat = this.timeSinceLastHeartbeat >= this.heartbeatRate;

        if (needsSync || needsHeartbeat) {
            this.syncState(needsHeartbeat);
            this.timeSinceLastSync = 0;
            if (needsHeartbeat) this.timeSinceLastHeartbeat = 0;
        }
    }

    private syncState(forceAll: boolean = false): void {
        const managers = this.context.managers;
        if (!managers.entity) return;

        // If forceAll is true, we send a full snapshot to keep connections alive and names synced
        if (forceAll || this.context.isHost) {
            const allStates = managers.entity.getWorldSnapshot();
            if (allStates.length > 0) {
                this.transport.broadcast(PACKET_TYPES.STATE_UPDATE, allStates);
            }
        } else {
            // For guests, heartbeat sends a fuller snapshot to recover from missed deltas.
            const authoritativeStates = managers.entity.getAuthoritativeStates(forceAll);
            if (authoritativeStates.length > 0) {
                if (this.context.roomId) {
                    this.transport.sendData(this.context.roomId, PACKET_TYPES.PLAYER_INPUT, authoritativeStates);
                }
            }
        }
    }
}
