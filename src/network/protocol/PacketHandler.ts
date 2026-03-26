export interface IPacketHandler<T = unknown> {
    handle(senderId: string, payload: T): void | Promise<void>;
}
