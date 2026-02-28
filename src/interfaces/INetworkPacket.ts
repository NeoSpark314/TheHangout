import { IRoomConfig } from '../core/GameState';
import { IReplicatedFeatureEventPayload, IReplicatedFeatureSnapshotPayload } from '../managers/ReplicationManager';

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

export interface IPeerDisconnectPayload {
    peerId: string;
}

export interface IRoomConfigUpdatePayload extends Partial<IRoomConfig> {
    assignedSpawnIndex?: number;
}

export interface IFeatureSnapshotRequestPayload {
    request?: boolean;
}

// A discriminated union of all possible packet payloads
export type NetworkPayload =
    | IOwnershipTransferPayload
    | IOwnershipRequestPayload
    | IOwnershipReleasePayload
    | IPeerDisconnectPayload
    | IRoomConfigUpdatePayload
    | IReplicatedFeatureEventPayload
    | IReplicatedFeatureSnapshotPayload
    | IFeatureSnapshotRequestPayload
    | any; // Fallback for unsupported packets
