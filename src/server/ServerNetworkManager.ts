import { AppContext } from '../app/AppContext';
import { IUpdatable } from '../shared/contracts/IUpdatable';
import { PACKET_TYPES } from '../shared/constants/Constants';
import { NetworkDispatcher } from '../network/protocol/PacketDispatcher';
import { INetworkTransport } from '../network/replication/StateSynchronizer';
import { EntityType } from '../shared/contracts/IEntityState';
import { PacketPayloadMap } from '../network/protocol/PacketTypes';
import { AuthoritativeSessionHost } from '../network/transport/AuthoritativeSessionHost';

export class ServerNetworkManager implements IUpdatable, INetworkTransport {
    private context!: AppContext;
    private dispatcher: NetworkDispatcher<PacketPayloadMap>;
    // Dedicated server transport keeps socket bookkeeping here, but the actual
    // host-authoritative sync rules live in the shared coordinator.
    private authoritativeHost!: AuthoritativeSessionHost;
    public connections: Map<string, any> = new Map(); // peerId -> WebSocket

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
    }

    public handleMessage(peerId: string, messageData: any): void {
        this.context.runtime.diagnostics.recordNetworkReceived(this.measurePayloadSize(messageData));
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
    }

    public relayToOthers(senderId: string, type: number, payload: unknown): void {
        const data = JSON.stringify({ type, payload, senderId }); // Inject senderId to identify source
        const dataLength = data.length;
        for (const [peerId, ws] of this.connections.entries()) {
            if (peerId !== senderId && ws?.readyState === 1) {
                ws.send(data);
                this.bytesSent += dataLength;
                this.context.runtime.diagnostics.recordNetworkSent(dataLength);
            }
        }
    }

    public broadcastNotification(message: string): void {
        this.broadcast(PACKET_TYPES.SESSION_NOTIFICATION, {
            kind: 'system',
            message: message,
            level: 'info',
            sentAt: this.nowMs()
        });
    }

    public spawnCube(): void {
        const sessionMgr = this.context.runtime.session;
        if (sessionMgr) {
            sessionMgr.spawnObjectModule('grabbable-cube');
        }
    }

    public resetSession(): void {
        const entityMgr = this.context.runtime.entity;
        const entities = Array.from(entityMgr.entities.values());
        entities.forEach(entity => {
            if (entity.type === EntityType.PHYSICS_PROP) {
                entityMgr.removeEntity(entity.id);
            }
        });
        // Re-init the session props
        this.context.runtime.session.init(null as any);
        this.broadcast(PACKET_TYPES.STATE_UPDATE, entityMgr.getWorldSnapshot());
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
}
