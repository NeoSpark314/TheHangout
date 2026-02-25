import { EntityState } from './IEntityState';

export interface OwnershipTransferPayload {
    entityId: string;
    newOwnerId: string;
}

export interface OwnershipRequestPayload {
    entityId: string;
}

export interface OwnershipReleasePayload {
    entityId: string;
}

export interface DrawSegmentPayload {
    start: [number, number, number];
    end: [number, number, number];
    color: string | number;
}

export interface PeerDisconnectPayload {
    peerId: string;
}

export interface RoomConfigUpdatePayload {
    sceneIndex?: number;
    // other configuration properties
    [key: string]: unknown;
}

// A discriminated union of all possible packet payloads
export type NetworkPayload =
    | EntityState[]
    | OwnershipTransferPayload
    | OwnershipRequestPayload
    | OwnershipReleasePayload
    | DrawSegmentPayload
    | PeerDisconnectPayload
    | RoomConfigUpdatePayload
    | any; // Fallback for unsupported packets
