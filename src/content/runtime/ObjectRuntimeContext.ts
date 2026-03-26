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
    ISharedPropPhysicsTuning,
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
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import type { PenToolEntity } from '../../world/entities/PenToolEntity';
import type { ISystemNotificationPayload } from '../../shared/contracts/INotification';
import type { IHoldable } from '../../shared/contracts/IHoldable';
import type { IInteractable } from '../../shared/contracts/IInteractable';

export class ObjectRuntimeContext implements IObjectRuntimeContext {
    private readonly cleanupCallbacks: Array<() => void> = [];
    private readonly sync: IInternalObjectSync;

    public readonly scene;
    public readonly assets;
    public readonly audio;
    public readonly particles;
    public readonly input;
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
            loadGLTF: (url: string) =>
                this.app.runtime.assets.loadGLTF(url),
            loadTexture: (url: string) =>
                this.app.runtime.assets.loadTexture(url)
        };

        this.audio = {
            createEmitter: (options: Parameters<IObjectRuntimeContext['audio']['createEmitter']>[0]) => {
                return this.app.runtime.audio.createEmitter(options);
            },
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

        this.particles = {
            createEmitter: (options: Parameters<IObjectRuntimeContext['particles']['createEmitter']>[0]) => {
                return this.app.runtime.particles.createEmitter(options);
            },
            spawnBurst: (options: Parameters<IObjectRuntimeContext['particles']['spawnBurst']>[0]) => {
                this.app.runtime.particles.spawnBurst(options);
            }
        };

        this.input = {
            getMovementVector: () => this.app.runtime.input?.getMovementVector?.() ?? { x: 0, y: 0 },
            isInteractHeld: () => this.app.runtime.input?.nonVRInteraction?.isInteractionHeld?.() ?? false
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

    public getSync(): IInternalObjectSync {
        return this.sync;
    }

    public createSharedBoxPropEntity(
        entityId: string,
        size: number,
        position: { x: number; y: number; z: number },
        mesh: any,
        halfExtents?: { x: number; y: number; z: number },
        moduleId?: string,
        ownerId?: string | null,
        grabbable?: boolean,
        physicsTuning?: ISharedPropPhysicsTuning,
        assetUrl?: string,
        color?: number | string,
        scale?: number,
        dualGrabScalable?: boolean,
        replicationProfileId?: string
    ): PhysicsPropEntity | null {
        return EntityFactory.createGrabbable(
            this.app,
            entityId,
            size,
            position,
            mesh,
            halfExtents,
            moduleId,
            ownerId,
            grabbable,
            physicsTuning,
            assetUrl,
            color,
            scale,
            dualGrabScalable,
            replicationProfileId as any
        );
    }

    public createSharedSpherePropEntity(
        entityId: string,
        radius: number,
        position: { x: number; y: number; z: number },
        mesh: any,
        moduleId?: string,
        ownerId?: string | null,
        grabbable?: boolean,
        physicsTuning?: ISharedPropPhysicsTuning,
        color?: number | string,
        replicationProfileId?: string
    ): PhysicsPropEntity | null {
        return EntityFactory.createSphereGrabbable(
            this.app,
            entityId,
            radius,
            position,
            mesh,
            moduleId,
            ownerId,
            grabbable,
            physicsTuning,
            color,
            replicationProfileId as any
        );
    }

    public createPenEntity(id: string, config: IObjectSpawnConfig): PenToolEntity | null {
        return EntityFactory.createPen(this.app, id, config);
    }

    public resolveSharedPropHandle(entityId: string): SharedPropHandle | null {
        return resolveSharedPropHandle(this.app, entityId);
    }

    public removeEntity(entityId: string): void {
        this.app.runtime.entity?.removeEntity(entityId);
    }

    public removePhysicsBody(body: IPhysicsBodyHandle | null | undefined): void {
        this.app.runtime.physics.removeRigidBody(body);
    }

    public createInteractionBox(
        halfExtents: { x: number; y: number; z: number },
        position: { x: number; y: number; z: number },
        target: IHoldable & IInteractable,
        rotation?: { x: number; y: number; z: number; w: number }
    ): IPhysicsColliderHandle | null {
        const collider = this.app.runtime.physics.createStaticCuboidSensor(
            halfExtents.x,
            halfExtents.y,
            halfExtents.z,
            position,
            rotation
        );
        if (!collider) return null;
        this.app.runtime.physics.registerInteractionCollider(collider, target);
        return collider;
    }

    public removeInteractionCollider(collider: IPhysicsColliderHandle | null | undefined): void {
        this.app.runtime.physics.unregisterInteractionCollider(collider);
    }

    public getLocalMountStatus(): ILocalMountStatus {
        return this.app.runtime.skills.mount.getLocalMountStatus();
    }

    public requestLocalMount(options: ILocalMountBinding): boolean {
        return this.app.runtime.skills.mount.requestLocalMount(options);
    }

    public grantLocalMount(options: ILocalMountBinding): boolean {
        return this.app.runtime.skills.mount.grantLocalMount(options);
    }

    public rejectLocalMount(): void {
        this.app.runtime.skills.mount.rejectLocalMount();
    }

    public releaseLocalMount(ownerInstanceId?: string, reason?: TLocalMountStateReason): void {
        this.app.runtime.skills.mount.releaseLocalMount(ownerInstanceId, reason);
    }

    public mountLocal(options: ILocalMountBinding): boolean {
        return this.app.runtime.skills.mount.mountLocal(options);
    }

    public unmountLocal(ownerInstanceId?: string, reason?: TLocalMountStateReason): void {
        this.app.runtime.skills.mount.unmountLocal(ownerInstanceId, reason);
    }

    public isMountedLocal(ownerInstanceId?: string): boolean {
        return this.app.runtime.skills.mount.isMountedLocal(ownerInstanceId);
    }

    public notifySystem(payload: ISystemNotificationPayload): void {
        this.app.runtime.notify.push(payload);
    }

    public getLocalPlayerPeerId(): string | null {
        return this.app.localPlayer?.id ?? null;
    }

    public getPlayerDisplayName(peerId: string): string | undefined {
        const entity = this.app.runtime.entity?.getEntity(peerId) as { name?: unknown } | undefined;
        if (entity && typeof entity.name === 'string' && entity.name.trim().length > 0) {
            return entity.name;
        }
        return undefined;
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
