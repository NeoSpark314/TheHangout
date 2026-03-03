import { IPacketHandler } from './PacketHandler';
import { NetworkEnvelope } from './PacketTypes';
import { isValidPayloadForType } from './PacketGuards';

type PacketMapBase = object;

function isNetworkEnvelope(value: unknown): value is { type: number; payload: unknown } {
    if (!value || typeof value !== 'object') return false;
    const maybe = value as Record<string, unknown>;
    return typeof maybe.type === 'number' && 'payload' in maybe;
}

export class NetworkDispatcher<TPacketMap extends PacketMapBase = PacketMapBase> {
    private handlers: Map<number, IPacketHandler<unknown>> = new Map();

    public registerHandler<K extends keyof TPacketMap & number>(
        type: K,
        handler: IPacketHandler<TPacketMap[K]>
    ): void {
        this.handlers.set(type, handler as IPacketHandler<unknown>);
    }

    public dispatch(senderId: string, data: unknown): void {
        try {
            const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as unknown;
            if (!isNetworkEnvelope(parsed)) return;

            const envelope = parsed as NetworkEnvelope;
            const handler = this.handlers.get(envelope.type);

            if (handler) {
                if (!isValidPayloadForType(envelope.type, envelope.payload)) {
                    console.warn(`[NetworkDispatcher] Dropping invalid payload for packet type ${envelope.type}`);
                    return;
                }
                handler.handle(senderId, envelope.payload);
            }
        } catch (e) {
            console.error('[NetworkDispatcher] Failed to dispatch packet:', e);
        }
    }
}
