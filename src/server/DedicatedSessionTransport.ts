import { AppContext } from '../app/AppContext';
import { IUpdatable } from '../shared/contracts/IUpdatable';
import { PACKET_TYPES } from '../shared/constants/Constants';
import { INetworkable } from '../shared/contracts/INetworkable';
import { NetworkDispatcher } from '../network/protocol/PacketDispatcher';
import { INetworkTransport } from '../network/replication/StateSynchronizer';
import { EntityType } from '../shared/contracts/IEntityState';
import { PacketPayloadMap } from '../network/protocol/PacketTypes';
import { AuthoritativeSessionHost } from '../network/transport/AuthoritativeSessionHost';
import { IPeerLatencyReportPayload } from '../shared/contracts/INetworkPacket';

interface IPeerAdminStats {
    connectedAt: number;
    lastMessageAt: number;
    bytesIn: number;
    bytesOut: number;
    latency: IPeerLatencyReportPayload | null;
}

export class DedicatedSessionTransport implements IUpdatable, INetworkTransport {
    private context!: AppContext;
    private dispatcher: NetworkDispatcher<PacketPayloadMap>;
    // Dedicated server transport keeps socket bookkeeping here, but the actual
    // host-authoritative sync rules live in the shared coordinator.
    private authoritativeHost!: AuthoritativeSessionHost;
    public connections: Map<string, any> = new Map(); // peerId -> WebSocket
    private peerStats: Map<string, IPeerAdminStats> = new Map();

    // Traffic metrics
    public bytesReceived: number = 0;
    public bytesSent: number = 0;

    constructor() {
        this.dispatcher = new NetworkDispatcher<PacketPayloadMap>();
    }

    public setContext(context: AppContext): void {
        this.context = context;
        this.authoritativeHost = new AuthoritativeSessionHost(this.context, this);
        this.authoritativeHost.registerHandlers(this.dispatcher);
    }

    public update(delta: number): void {
        if (this.authoritativeHost) {
            this.authoritativeHost.update(delta);
        }
    }

    public addClient(peerId: string, ws: any): void {
        this.connections.set(peerId, ws);
        this.peerStats.set(peerId, {
            connectedAt: Date.now(),
            lastMessageAt: Date.now(),
            bytesIn: 0,
            bytesOut: 0,
            latency: null
        });
        this.context.runtime.diagnostics.record('info', 'network', `Relay client joined (${peerId})`);

        this.authoritativeHost.sendWelcomeState(peerId, this.connections.size);

        this.authoritativeHost.notifyPeerJoined(peerId);
    }

    public removeClient(peerId: string): void {
        this.connections.delete(peerId);
        this.context.runtime.diagnostics.record('info', 'network', `Relay client left (${peerId})`);
        this.authoritativeHost.reclaimOwnership(peerId);
        if (this.context.runtime.entity) {
            this.context.runtime.entity.removeEntity(peerId);
        }
        this.authoritativeHost.notifyPeerDisconnected(peerId);
        this.peerStats.delete(peerId);
    }

    public handleMessage(peerId: string, messageData: any): void {
        const messageSize = this.measurePayloadSize(messageData);
        this.context.runtime.diagnostics.recordNetworkReceived(messageSize);
        const peerStats = this.peerStats.get(peerId);
        if (peerStats) {
            peerStats.lastMessageAt = Date.now();
            peerStats.bytesIn += messageSize;
        }
        if (messageData.type === PACKET_TYPES.AUDIO_CHUNK) {
            this.relayToOthers(peerId, PACKET_TYPES.AUDIO_CHUNK, messageData.payload);
            return;
        }
        this.dispatcher.dispatch(peerId, messageData);
        // Approximate byte size
        this.bytesReceived += JSON.stringify(messageData).length;
    }

    // --- INetworkTransport implementation ---
    public sendData(targetId: string, type: number, payload: unknown, senderId?: string): void {
        const ws = this.connections.get(targetId);
        if (ws && ws.readyState === 1) { // 1 = OPEN
            const data = JSON.stringify({ type, payload, senderId });
            ws.send(data);
            this.bytesSent += data.length;
            this.notePeerBytesOut(targetId, data.length);
            this.context.runtime.diagnostics.recordNetworkSent(data.length);
        }
    }

    public broadcast(type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload });
        const dataLength = data.length;
        for (const ws of this.connections.values()) {
            if (ws?.readyState === 1) {
                ws.send(data);
                this.bytesSent += dataLength;
                this.context.runtime.diagnostics.recordNetworkSent(dataLength);
            }
        }
        for (const peerId of this.connections.keys()) {
            this.notePeerBytesOut(peerId, dataLength);
        }
    }

    public relayToOthers(senderId: string, type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload, senderId }); // Inject senderId to identify source
        const dataLength = data.length;
        for (const [peerId, ws] of this.connections.entries()) {
            if (peerId !== senderId && ws?.readyState === 1) {
                ws.send(data);
                this.bytesSent += dataLength;
                this.notePeerBytesOut(peerId, dataLength);
                this.context.runtime.diagnostics.recordNetworkSent(dataLength);
            }
        }
    }

    public handlePeerLatencyReport(peerId: string, payload: IPeerLatencyReportPayload): void {
        const stats = this.peerStats.get(peerId);
        if (!stats) return;

        stats.lastMessageAt = Date.now();
        stats.latency = payload;
    }

    public syncEntityNow(entityId: string, forceFullState: boolean = false): void {
        const entity = this.context.runtime.entity?.getEntity(entityId);
        if (!entity || entity.isDestroyed) return;

        const networkable = entity as unknown as INetworkable<unknown>;
        if (!networkable.getNetworkState) return;

        const state = networkable.getNetworkState(forceFullState);
        if (!state) return;

        this.broadcast(PACKET_TYPES.STATE_UPDATE, [{
            id: entity.id,
            type: entity.type as EntityType,
            scenarioEpoch: this.context.sessionConfig.scenarioEpoch,
            state
        }]);
    }

    public getPeerAdminStats(peerId: string): {
        connectedAt: number;
        lastMessageAt: number;
        bytesIn: number;
        bytesOut: number;
        latency: IPeerLatencyReportPayload | null;
    } | null {
        const stats = this.peerStats.get(peerId);
        if (!stats) return null;

        return {
            connectedAt: stats.connectedAt,
            lastMessageAt: stats.lastMessageAt,
            bytesIn: stats.bytesIn,
            bytesOut: stats.bytesOut,
            latency: stats.latency
        };
    }

    public broadcastNotification(message: string): void {
        this.broadcast(PACKET_TYPES.SESSION_NOTIFICATION, {
            kind: 'system',
            message,
            level: 'info',
            sentAt: this.nowMs()
        });
    }

    public async requestSessionConfigUpdate(payload: PacketPayloadMap[typeof PACKET_TYPES.SESSION_CONFIG_UPDATE]): Promise<void> {
        // Reuse the shared host-side config transition path so admin-triggered
        // scenario changes behave exactly like any other authoritative update.
        await this.authoritativeHost.applySessionConfigUpdate(payload);
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    private measurePayloadSize(data: unknown): number {
        if (!data) return 0;
        if (typeof data === 'string') return data.length;
        if (data instanceof ArrayBuffer) return data.byteLength;
        if (ArrayBuffer.isView(data)) return data.byteLength;

        try {
            return JSON.stringify(data).length;
        } catch {
            return 0;
        }
    }

    private notePeerBytesOut(peerId: string, bytes: number): void {
        const stats = this.peerStats.get(peerId);
        if (!stats || bytes <= 0) return;

        stats.bytesOut += bytes;
    }
}
