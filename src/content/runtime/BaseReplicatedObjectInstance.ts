import type { IObjectRuntimeContext } from '../contracts/IObjectRuntimeContext';
import type { IObjectReplicationMeta, IReplicatedObjectInstance } from '../contracts/IReplicatedObjectInstance';
import { BaseObjectInstance } from './BaseObjectInstance';

export abstract class BaseReplicatedObjectInstance extends BaseObjectInstance implements IReplicatedObjectInstance {
    public readonly replicationKey: string;

    constructor(context: IObjectRuntimeContext, moduleId: string) {
        super(context, moduleId);
        this.replicationKey = `object:${moduleId}:${context.instanceId}`;
    }

    protected emitSyncEvent(eventType: string, data: unknown): void {
        this.context.sync.emit(eventType, data);
    }

    public abstract onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void;
    public captureReplicationSnapshot?(): unknown;
    public applyReplicationSnapshot?(snapshot: unknown): void;
}
