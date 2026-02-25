import { IPacketHandler } from './PacketHandler';

export class NetworkDispatcher {
    private handlers: Map<number, IPacketHandler> = new Map();

    public registerHandler(type: number, handler: IPacketHandler): void {
        this.handlers.set(type, handler);
    }

    public dispatch(senderId: string, data: unknown): void {
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data as any;
            const handler = this.handlers.get(parsed.type);

            if (handler) {
                handler.handle(senderId, parsed.payload);
            }
        } catch (e) {
            console.error('[NetworkDispatcher] Failed to dispatch packet:', e);
        }
    }
}
