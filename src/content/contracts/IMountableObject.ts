export interface IMountableObject {
    canMount?(playerId: string): boolean;
    mount?(playerId: string): boolean;
    unmount?(playerId: string): void;
    isOccupied?(): boolean;
}
