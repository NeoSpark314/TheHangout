export interface PacketHandler {
    handle(senderId: string, payload: any): void;
}
