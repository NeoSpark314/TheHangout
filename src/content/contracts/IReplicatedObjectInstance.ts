import type { ISpawnedObjectInstance } from './ISpawnedObjectInstance';

export interface IObjectReplicationMeta {
    eventId: string;
    originPeerId: string;
    senderId: string | null;
    local: boolean;
    sentAt: number;
}

export interface IObjectReplicationPolicy {
    /**
     * Host relay behavior for events originating from guests.
     * - others: relay to all peers except sender (default)
     * - none: do not relay guest events for this object
     */
    relayIncomingFromPeer?: 'others' | 'none';
    /**
     * Whether this object contributes to late-join feature snapshots.
     * Defaults to true.
     */
    includeInSnapshot?: boolean;
    /**
     * Default behavior for whether local emits are immediately applied locally.
     * Defaults to true.
     */
    defaultLocalEcho?: boolean;
}

export interface IObjectReplicationEmitOptions {
    localEcho?: boolean;
}

export interface IReplicatedObjectInstance extends ISpawnedObjectInstance {
    replicationKey: string;
    replicationPolicy?: IObjectReplicationPolicy;

    onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void;
    captureReplicationSnapshot?(): unknown;
    applyReplicationSnapshot?(snapshot: unknown): void;
}
