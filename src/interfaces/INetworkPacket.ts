import { IEntityState } from './IEntityState';
import { IRoomConfig } from '../core/GameState';

export interface IOwnershipTransferPayload {
    entityId: string;
    newOwnerId: string | null;
    seq?: number;
    sentAt?: number;
}

export interface IOwnershipRequestPayload {
    entityId: string;
    seq?: number;
    sentAt?: number;
}

export interface IOwnershipReleasePayload {
    entityId: string;
    velocity?: [number, number, number];
    position?: [number, number, number];
    quaternion?: [number, number, number, number];
    seq?: number;
    sentAt?: number;
}

export interface IDrawSegmentPayload {
    startPos: number[]; // [x,y,z]
    endPos: number[];   // [x,y,z]
    color: string | number;
}

export interface IPeerDisconnectPayload {
    peerId: string;
}

export interface IRoomConfigUpdatePayload extends Partial<IRoomConfig> {
    assignedSpawnIndex?: number;
}

// A discriminated union of all possible packet payloads
export type NetworkPayload =
    | IOwnershipTransferPayload
    | IOwnershipRequestPayload
    | IOwnershipReleasePayload
    | IDrawSegmentPayload
    | IPeerDisconnectPayload
    | IRoomConfigUpdatePayload
    | any; // Fallback for unsupported packets
