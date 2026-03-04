import { ISessionConfig } from '../../app/AppContext';
import { IReplicatedFeatureEventPayload, IReplicatedFeatureSnapshotPayload } from '../../network/replication/FeatureReplicationService';

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

export interface ISessionConfigUpdatePayload extends Partial<ISessionConfig> {
    assignedSpawnIndex?: number;
}

export interface IFeatureSnapshotRequestPayload {
    request?: boolean;
}

export interface IDesktopSourcesStatusRequestPayload {
    keys: string[];
}

export interface IDesktopSourcesStatusResponsePayload {
    statuses: Record<string, boolean>;
    activeKeys?: string[];
    capturingKeys?: string[];
    activeNames?: Record<string, string>;
    activeSummonerNames?: Record<string, string>;
}

export interface IDesktopStreamSummonPayload {
    key: string;
    name?: string;
    summonerName?: string;
    anchor?: [number, number, number];
    quaternion?: [number, number, number, number];
}

export interface IDesktopStreamStopPayload {
    key: string;
}

export interface IDesktopStreamSummonedPayload {
    key: string;
    name?: string;
    sessionId: string;
    anchor?: [number, number, number];
    quaternion?: [number, number, number, number];
    summonedByPeerId?: string;
    summonedByName?: string;
}

export interface IDesktopStreamStoppedPayload {
    key: string;
    sessionId: string;
}

export interface IDesktopStreamOfflinePayload {
    key: string;
    sessionId: string;
}

export interface IDesktopStreamFramePayload {
    key: string;
    name?: string;
    sessionId: string;
    dataUrl: string;
    width?: number;
    height?: number;
    ts?: number;
    anchor?: [number, number, number];
    quaternion?: [number, number, number, number];
}

export interface ISessionNotificationPayload {
    kind: string;
    actorPeerId?: string;
    actorName?: string;
    subjectName?: string;
    message?: string;
    level?: 'info' | 'warn' | 'error';
    sentAt?: number;
}

export interface IRttPingPayload {
    probeId: string;
    clientSentAt: number;
}

export interface IRttPongPayload {
    probeId: string;
    clientSentAt: number;
    serverReceivedAt: number;
    serverSentAt: number;
}

// A discriminated union of all possible packet payloads
export type NetworkPayload =
    | IOwnershipTransferPayload
    | IOwnershipRequestPayload
    | IOwnershipReleasePayload
    | IPeerDisconnectPayload
    | ISessionConfigUpdatePayload
    | IReplicatedFeatureEventPayload
    | IReplicatedFeatureSnapshotPayload
    | IFeatureSnapshotRequestPayload
    | IDesktopSourcesStatusRequestPayload
    | IDesktopSourcesStatusResponsePayload
    | IDesktopStreamSummonPayload
    | IDesktopStreamStopPayload
    | IDesktopStreamSummonedPayload
    | IDesktopStreamStoppedPayload
    | IDesktopStreamOfflinePayload
    | IDesktopStreamFramePayload
    | ISessionNotificationPayload
    | IRttPingPayload
    | IRttPongPayload
    | any; // Fallback for unsupported packets
