import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import type { AppContext } from '../../app/AppContext';
import type {
    IObjectRuntimeContext,
    IPhysicsBodyHandle,
    IPhysicsColliderHandle
} from '../contracts/IObjectRuntimeContext';
import type { IObjectSpawnConfig } from '../contracts/IObjectModule';
import type { ISpawnedObjectInstance } from '../contracts/ISpawnedObjectInstance';

export class ObjectRuntimeContext implements IObjectRuntimeContext {
    private readonly cleanupCallbacks: Array<() => void> = [];

    public readonly scene;
    public readonly physics;
    public readonly audio;
    public readonly entity;
    public readonly tracking;
    public readonly sync;
    public readonly mount;
    public readonly objects;

    constructor(
        public readonly app: AppContext,
        public readonly instanceId: string
    ) {
        this.scene = {
            add: (object) => {
                this.app.runtime.render?.scene.add(object);
            },
            remove: (object) => {
                this.app.runtime.render?.scene.remove(object);
            }
        };

        this.physics = {
            createStaticCuboidCollider: (hx, hy, hz, position, rotation) =>
                this.app.runtime.physics.createStaticCuboidCollider(hx, hy, hz, position, rotation),
            registerInteractionCollider: (collider, target) => {
                this.app.runtime.physics.registerInteractionCollider(collider, target as any);
            },
            unregisterInteractionCollider: (collider) => {
                this.app.runtime.physics.unregisterInteractionCollider(collider);
            },
            removeRigidBody: (body: IPhysicsBodyHandle | null | undefined) => {
                this.app.runtime.physics.removeRigidBody(body);
            }
        };

        this.audio = {
            playDrumPadHit: (options) => {
                this.app.runtime.audio?.playDrumPadHit(options);
            }
        };

        this.entity = {
            get: (entityId: string) => this.app.runtime.entity?.getEntity(entityId)
        };

        this.tracking = {
            getState: () => this.app.runtime.tracking?.getState?.() ?? null,
            getLocalPlayer: () => this.app.localPlayer
        };

        this.sync = {
            emit: (eventType, data) => {
                this.app.runtime.session.emitObjectInstanceEvent(this.instanceId, eventType, data);
            }
        };

        this.mount = {
            mountLocal: (options) => this.app.runtime.mount.mountLocal(options),
            unmountLocal: (ownerInstanceId?: string) => this.app.runtime.mount.unmountLocal(ownerInstanceId),
            isMountedLocal: (ownerInstanceId?: string) => this.app.runtime.mount.isMountedLocal(ownerInstanceId)
        };

        this.objects = {
            spawn: (moduleId: string, config: IObjectSpawnConfig = {}) =>
                this.app.runtime.session.spawnObjectInstance(moduleId, config),
            get: (instanceId: string) => this.app.runtime.session.getObjectInstance(instanceId),
            getFirstByModuleId: (moduleId: string) => this.app.runtime.session.getFirstObjectInstanceByModuleId(moduleId),
            remove: (instanceId: string) => {
                this.app.runtime.session.removeObjectInstance(instanceId);
            }
        };
    }

    public onPhysicsCollisionStarted(
        callback: (data: { handleA: number; handleB: number; entityAId: string | null; entityBId: string | null }) => void
    ): () => void {
        eventBus.on(EVENTS.PHYSICS_COLLISION_STARTED, callback);
        const unsubscribe = () => {
            eventBus.off(EVENTS.PHYSICS_COLLISION_STARTED, callback);
        };
        this.onCleanup(unsubscribe);
        return unsubscribe;
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
}
