import type { IScenarioModule } from './IScenarioModule';

export interface IScenarioReplicationMeta {
    eventId: string;
    originPeerId: string;
    senderId: string | null;
    local: boolean;
    sentAt: number;
}

export interface IScenarioReplicationPolicy {
    /**
     * Host relay behavior for events arriving from guests.
     * - others: relay to all peers except sender (default)
     * - none: do not relay guest events for this scenario
     */
    relayIncomingFromPeer?: 'others' | 'none';
    /**
     * Whether this scenario contributes to late-join feature snapshots.
     * Defaults to true.
     */
    includeInSnapshot?: boolean;
    /**
     * Default behavior for whether local emits are immediately applied locally.
     * Defaults to true.
     */
    defaultLocalEcho?: boolean;
}

export interface IScenarioReplicationEmitOptions {
    localEcho?: boolean;
}

export interface IReplicatedScenarioModule extends IScenarioModule {
    replicationKey: string;
    replicationPolicy?: IScenarioReplicationPolicy;

    onScenarioReplicationEvent(eventType: string, data: unknown, meta: IScenarioReplicationMeta): void;
    captureScenarioReplicationSnapshot?(): unknown;
    applyScenarioReplicationSnapshot?(snapshot: unknown): void;
}
