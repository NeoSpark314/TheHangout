import { GameContext } from '../core/GameState';
import { PACKET_TYPES } from '../utils/Constants';

export interface NetworkTransport {
    broadcast(type: number, payload: any): void;
    sendData(targetId: string, type: number, payload: any): void;
}

export class NetworkSynchronizer {
    private transport: NetworkTransport;
    private syncRate: number = 1 / 20;
    private timeSinceLastSync: number = 0;

    constructor(transport: NetworkTransport, private context: GameContext) {
        this.transport = transport;
    }

    public update(delta: number): void {
        this.timeSinceLastSync += delta;
        if (this.timeSinceLastSync >= this.syncRate) {
            this.timeSinceLastSync = 0;
            this.syncState();
        }
    }

    private syncState(): void {
        const managers = this.context.managers;
        if (!managers.entity) return;

        const authoritativeStates = managers.entity.getAuthoritativeStates();
        if (authoritativeStates.length === 0) return;

        if (this.context.isHost) {
            const allStates = managers.entity.getWorldSnapshot();
            this.transport.broadcast(PACKET_TYPES.STATE_UPDATE, allStates);
        } else if (this.context.roomId) {
            this.transport.sendData(this.context.roomId, PACKET_TYPES.PLAYER_INPUT, authoritativeStates);
        }
    }
}
