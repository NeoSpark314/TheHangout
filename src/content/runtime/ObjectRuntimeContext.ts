import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import type { AppContext } from '../../app/AppContext';
import { EntityType } from '../../shared/contracts/IEntityState';
import type {
    ICollisionStartedEvent,
    IInternalObjectSync,
    IObjectRuntimeContext,
    IPhysicsBodyHandle,
    IPhysicsColliderHandle,
    ISharedPropHandle,
    ISharedPropImpulseOptions,
    ISharedPropSpawnOptions,
    ISharedPropRaycastHit
} from '../contracts/IObjectRuntimeContext';
import type { IObjectSpawnConfig } from '../contracts/IObjectModule';
import type { ILocalMountBinding, ILocalMountStatus, TLocalMountStateReason } from '../contracts/IMounting';
import type { IObjectReplicationEmitOptions } from '../contracts/IReplicatedObjectInstance';
import type { ISpawnedObjectInstance } from '../contracts/ISpawnedObjectInstance';
import { createSharedPropHandle, resolveSharedPropHandle, SharedPropHandle } from './SharedPropHandle';
import { spawnSharedPhysicsProp } from './SharedPhysicsPropSpawner';
import { EntityFactory } from '../../world/spawning/EntityFactory';

export class ObjectRuntimeContext implements IObjectRuntimeContext {
    private readonly cleanupCallbacks: Array<() => void> = [];
    private readonly sync: IInternalObjectSync;

    public readonly scene;
    public readonly assets;
    public readonly audio;
    public readonly tracking;
    public readonly players;
    public readonly actions;
    public readonly props;
    public readonly triggers;
    public readonly events;
    public readonly objects;

    constructor(
        private readonly app: AppContext,
        public readonly instanceId: string,
        private readonly moduleId: string
    ) {
        this.scene = {
            add: (object: any) => {
                this.app.runtime.render?.scene.add(object);
            },
            remove: (object: any) => {
                this.app.runtime.render?.scene.remove(object);
            },
            isRenderingAvailable: () => !!this.app.runtime.render
        };

        this.assets = {
            getNormalizedModel: (url: string, targetSize?: number) =>
                this.app.runtime.assets.getNormalizedModel(url, targetSize),
            loadTexture: (url: string) =>
                this.app.runtime.assets.loadTexture(url)
        };

        this.audio = {
            playDrumPadHit: (options: { frequency: number; intensity: number; position?: { x: number; y: number; z: number } }) => {
                this.app.runtime.audio?.playDrumPadHit(options);
            },
            playSequencerBeat: (options: { beat: 'kick' | 'snare' | 'hat' | 'bass'; intensity?: number; position?: { x: number; y: number; z: number } }) => {
                this.app.runtime.audio?.playSequencerBeat(options);
            },
            playMelodyNote: (options: { frequency: number; intensity?: number; position?: { x: number; y: number; z: number } }) => {
                this.app.runtime.audio?.playMelodyNote(options);
            },
            playArpNote: (options: { frequency: number; intensity?: number; brightness?: number; position?: { x: number; y: number; z: number } }) => {
                this.app.runtime.audio?.playArpNote(options);
            },
            playFxSweep: (options: { down?: boolean; intensity?: number; position?: { x: number; y: number; z: number } }) => {
                this.app.runtime.audio?.playFxSweep(options);
            }
        };

        this.tracking = {
            getState: () => this.app.runtime.tracking?.getState?.() ?? null,
            getLocalPlayer: () => this.app.localPlayer
        };

        this.players = {
            getLocal: () => this.app.localPlayer,
            get: (peerId: string) => {
                const entity = this.app.runtime.entity.getEntity(peerId);
                if (!entity || entity.type !== EntityType.PLAYER_AVATAR) return null;
                return entity as any;
            }
        };

        this.actions = {
            request: (actionId: string, payload?: unknown) => {
                this.app.runtime.network.requestScenarioAction(actionId, payload);
            },
            isHost: () => this.app.isHost
        };

        this.props = {
            spawnShared: (options: ISharedPropSpawnOptions) => {
                const entity = spawnSharedPhysicsProp(this, this.moduleId, options);
                if (!entity) return null;
                return new SharedPropHandle(this.app, entity.id);
            },
            get: (entityId: string) => createSharedPropHandle(this, entityId),
            applyImpulse: (
                target: string | ISharedPropHandle,
                impulse: { x: number; y: number; z: number },
                point: { x: number; y: number; z: number },
                options?: ISharedPropImpulseOptions
            ) => {
                const handle = resolveSharedPropHandle(this.app, target);
                if (!handle) return false;
                return this.app.runtime.physics.applyInteractionImpulse(handle.entityId, impulse, point, options);
            },
            raycast: (origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, maxDist: number): ISharedPropRaycastHit | null => {
                const hit = this.app.runtime.physics.raycast(origin, direction, maxDist);
                if (!hit) return null;
                return {
                    ...hit,
                    prop: hit.entityId ? createSharedPropHandle(this, hit.entityId) : null
                };
            }
        };

        this.triggers = {
            createBox: (options: any) => this.app.runtime.session.createTriggerBox(options)
        };

        this.events = {
            onCollisionStarted: (
                callback: (event: ICollisionStartedEvent) => void
            ) => this.onCollisionStarted(callback)
        };

        this.sync = {
            emit: (eventType: string, data: Record<string, any>, options?: IObjectReplicationEmitOptions) => {
                this.app.runtime.session.emitObjectInstanceEvent(this.instanceId, eventType, data, options);
            }
        };

        this.objects = {
            spawn: (spawnModuleId: string, config: IObjectSpawnConfig = {}) =>
                this.app.runtime.session.spawnObjectInstance(spawnModuleId, config),
            get: (spawnInstanceId: string) => this.app.runtime.session.getObjectInstance(spawnInstanceId),
            getFirstByModuleId: (spawnModuleId: string) => this.app.runtime.session.getFirstObjectInstanceByModuleId(spawnModuleId),
            remove: (spawnInstanceId: string) => {
                this.app.runtime.session.removeObjectInstance(spawnInstanceId);
            }
        };
    }

    public getAppContext(): AppContext {
        return this.app;
    }

    public getSync(): IInternalObjectSync {
        return this.sync;
    }

    public getEntityById(entityId: string): unknown {
        return this.app.runtime.entity?.getEntity(entityId);
    }

    public removeOwnedEntity(entityId: string): void {
        this.app.runtime.entity?.removeEntity(entityId);
    }

    public removeOwnedPhysicsBody(body: IPhysicsBodyHandle | null | undefined): void {
        this.app.runtime.physics.removeRigidBody(body);
    }

    public spawnInternalEntity(kind: string, id: string, config: IObjectSpawnConfig): unknown {
        return EntityFactory.spawn(this.app, kind, id, config);
    }

    public getMountApi() {
        return this.app.runtime.mount;
    }

    public getLocalMountStatus(): ILocalMountStatus {
        return this.app.runtime.mount.getLocalMountStatus();
    }

    public requestLocalMount(options: ILocalMountBinding): boolean {
        return this.app.runtime.mount.requestLocalMount(options);
    }

    public grantLocalMount(options: ILocalMountBinding): boolean {
        return this.app.runtime.mount.grantLocalMount(options);
    }

    public rejectLocalMount(): void {
        this.app.runtime.mount.rejectLocalMount();
    }

    public releaseLocalMount(ownerInstanceId?: string, reason?: TLocalMountStateReason): void {
        this.app.runtime.mount.releaseLocalMount(ownerInstanceId, reason);
    }

    public mountLocal(options: ILocalMountBinding): boolean {
        return this.app.runtime.mount.mountLocal(options);
    }

    public unmountLocal(ownerInstanceId?: string, reason?: TLocalMountStateReason): void {
        this.app.runtime.mount.unmountLocal(ownerInstanceId, reason);
    }

    public isMountedLocal(ownerInstanceId?: string): boolean {
        return this.app.runtime.mount.isMountedLocal(ownerInstanceId);
    }

    public pushNotification(payload: unknown): void {
        this.app.runtime.notify.push(payload as any);
    }

    public getLocalPlayerId(): string | null {
        return this.app.localPlayer?.id ?? null;
    }

    public isHost(): boolean {
        return this.app.isHost;
    }

    public onCleanup(cleanup: () => void): void {
        this.cleanupCallbacks.push(cleanup);
    }

    public runCleanupCallbacks(): void {
        while (this.cleanupCallbacks.length > 0) {
            const cleanup = this.cleanupCallbacks.pop();
            if (!cleanup) break;
            try {
                cleanup();
            } catch (error) {
                console.error('[ObjectRuntimeContext] Cleanup callback failed:', error);
            }
        }
    }

    private onCollisionStarted(
        callback: (event: ICollisionStartedEvent) => void
    ): () => void {
        const wrapped = (data: { handleA: number; handleB: number; entityAId: string | null; entityBId: string | null }) => {
            callback({
                colliderAId: data.handleA,
                colliderBId: data.handleB,
                entityAId: data.entityAId,
                entityBId: data.entityBId,
                propA: data.entityAId ? createSharedPropHandle(this, data.entityAId) : null,
                propB: data.entityBId ? createSharedPropHandle(this, data.entityBId) : null
            });
        };
        eventBus.on(EVENTS.PHYSICS_COLLISION_STARTED, wrapped);
        const unsubscribe = () => {
            eventBus.off(EVENTS.PHYSICS_COLLISION_STARTED, wrapped);
        };
        this.onCleanup(unsubscribe);
        return unsubscribe;
    }
}
