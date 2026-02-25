export interface PacketHandler<T = unknown> {
    handle(senderId: string, payload: T): void;
}
