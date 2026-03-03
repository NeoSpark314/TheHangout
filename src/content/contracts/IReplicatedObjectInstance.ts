import type { ISpawnedObjectInstance } from './ISpawnedObjectInstance';

export interface IObjectReplicationMeta {
    eventId: string;
    originPeerId: string;
    senderId: string | null;
    local: boolean;
    sentAt: number;
}

export interface IReplicatedObjectInstance extends ISpawnedObjectInstance {
    replicationKey: string;

    onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void;
    captureReplicationSnapshot?(): unknown;
    applyReplicationSnapshot?(snapshot: unknown): void;
}
