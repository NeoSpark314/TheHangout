import type { IObjectRuntimeContext } from '../contracts/IObjectRuntimeContext';
import type {
    IObjectReplicationEmitOptions,
    IObjectReplicationMeta,
    IObjectReplicationPolicy,
    IReplicatedObjectInstance
} from '../contracts/IReplicatedObjectInstance';
import { BaseObjectInstance } from './BaseObjectInstance';

export abstract class BaseReplicatedObjectInstance extends BaseObjectInstance implements IReplicatedObjectInstance {
    public readonly replicationKey: string;
    public readonly replicationPolicy: IObjectReplicationPolicy = {
        relayIncomingFromPeer: 'others',
        includeInSnapshot: true,
        defaultLocalEcho: true
    };

    constructor(context: IObjectRuntimeContext, moduleId: string) {
        super(context, moduleId);
        this.replicationKey = `object:${moduleId}:${context.instanceId}`;
    }

    protected emitSyncEvent(eventType: string, data: unknown, options?: IObjectReplicationEmitOptions): void {
        this.context.sync.emit(eventType, data, options);
    }

    public abstract onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void;
    public captureReplicationSnapshot?(): unknown;
    public applyReplicationSnapshot?(snapshot: unknown): void;
}
