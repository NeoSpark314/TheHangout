import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import { EntityType } from '../../shared/contracts/IEntityState';
import type { IPose, IVector3 } from '../../shared/contracts/IMath';
import type {
    IPhysicsColliderHandle,
    ISharedPropHandle,
    IAudioApi
} from '../contracts/IObjectRuntimeContext';
import type {
    IScenarioContext,
    IScenarioPlayerHandle,
    IScenarioPlayerTeleportOptions,
    IScenarioPropResetOptions,
    IScenarioStaticBodyHandle,
    IScenarioStaticBoxOptions
} from '../contracts/IScenarioContext';
import type { IObjectSpawnConfig } from '../contracts/IObjectModule';
import type { ISpawnedObjectInstance } from '../contracts/ISpawnedObjectInstance';
import type { IScenarioReplicationEmitOptions } from '../contracts/IReplicatedScenarioModule';
import { resolveSharedPropHandle } from './SharedPropHandle';
import type { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import type { SessionRuntime } from '../../world/session/SessionRuntime';

class ScenarioPlayerHandle implements IScenarioPlayerHandle {
    constructor(
        private readonly context: AppContext,
        public readonly id: string
    ) { }

    public getDisplayName(): string {
        const entity = this.getEntity();
        const name = entity?.name?.trim();
        if (name) return name;
        return compactPlayerId(this.id);
    }

    public isLocal(): boolean {
        return this.context.localPlayer?.id === this.id;
    }

    private getEntity(): PlayerAvatarEntity | null {
        const entity = this.context.runtime.entity.getEntity(this.id);
        if (!entity || entity.type !== EntityType.PLAYER_AVATAR) return null;
        return entity as PlayerAvatarEntity;
    }
}

class ScenarioStaticBodyHandle implements IScenarioStaticBodyHandle {
    private destroyed = false;

    constructor(
        public readonly id: string,
        private readonly app: AppContext,
        private readonly collider: IPhysicsColliderHandle
    ) { }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.app.runtime.physics.removeRigidBody(this.collider.body);
    }
}

export class ScenarioRuntimeContext implements IScenarioContext {
    private readonly cleanupCallbacks: Array<() => void> = [];
    private nextStaticBodyId = 0;

    public readonly scene;
    public readonly assets;
    public readonly audio;
    public readonly players;
    public readonly objects;
    public readonly props;
    public readonly physics;
    public readonly actions;
    public readonly events;
    public readonly timers;
    public readonly random;

    constructor(
        private readonly app: AppContext,
        private readonly session: SessionRuntime
    ) {
        this.scene = {
            add: (object: THREE.Object3D) => {
                this.app.runtime.render?.scene.add(object);
            },
            remove: (object: THREE.Object3D) => {
                this.app.runtime.render?.scene.remove(object);
            },
            isRenderingAvailable: () => !!this.app.runtime.render,
            getCamera: () => this.app.runtime.render?.camera ?? null,
            getRenderer: () => this.app.runtime.render?.renderer ?? null,
            getRoot: () => this.app.runtime.render?.scene ?? null
        };

        this.assets = {
            getNormalizedModel: (url: string, targetSize?: number) =>
                this.app.runtime.assets.getNormalizedModel(url, targetSize),
            loadTexture: (url: string) =>
                this.app.runtime.assets.loadTexture(url)
        };

        this.audio = {
            playDrumPadHit: (options: Parameters<IAudioApi['playDrumPadHit']>[0]) => {
                this.app.runtime.audio?.playDrumPadHit(options);
            },
            playSequencerBeat: (options: Parameters<IAudioApi['playSequencerBeat']>[0]) => {
                this.app.runtime.audio?.playSequencerBeat(options);
            },
            playMelodyNote: (options: Parameters<IAudioApi['playMelodyNote']>[0]) => {
                this.app.runtime.audio?.playMelodyNote(options);
            },
            playArpNote: (options: Parameters<IAudioApi['playArpNote']>[0]) => {
                this.app.runtime.audio?.playArpNote(options);
            },
            playFxSweep: (options: Parameters<IAudioApi['playFxSweep']>[0]) => {
                this.app.runtime.audio?.playFxSweep(options);
            }
        };

        this.players = {
            getLocal: () => {
                const localId = this.app.localPlayer?.id;
                return localId ? new ScenarioPlayerHandle(this.app, localId) : null;
            },
            get: (peerId: string) => this.getPlayerHandle(peerId),
            getAll: () => Array.from(this.app.runtime.entity.entities.values())
                .filter((entity) => entity.type === EntityType.PLAYER_AVATAR)
                .map((entity) => new ScenarioPlayerHandle(this.app, entity.id))
                .sort((a, b) => a.id.localeCompare(b.id)),
            teleport: (
                target: string | IScenarioPlayerHandle,
                position: IVector3,
                yaw: number,
                options?: IScenarioPlayerTeleportOptions
            ) => {
                const playerId = typeof target === 'string' ? target : target.id;
                const localPlayer = this.app.localPlayer;
                if (!localPlayer || localPlayer.id !== playerId) return false;
                localPlayer.teleportTo(
                    new THREE.Vector3(position.x, position.y, position.z),
                    yaw,
                    { targetSpace: options?.targetSpace }
                );
                return true;
            },
            getDisplayName: (target: string | IScenarioPlayerHandle) => {
                const playerId = typeof target === 'string' ? target : target.id;
                return this.getPlayerHandle(playerId)?.getDisplayName() ?? compactPlayerId(playerId);
            }
        };

        this.objects = {
            spawn: (moduleId: string, config: IObjectSpawnConfig = {}) =>
                this.session.spawnObjectInstance(moduleId, config),
            get: (instanceId: string) => this.session.getObjectInstance(instanceId),
            getFirstByModuleId: (moduleId: string) => this.session.getFirstObjectInstanceByModuleId(moduleId),
            remove: (instanceId: string) => {
                this.session.removeObjectInstance(instanceId);
            }
        };

        this.props = {
            get: (entityId: string) => {
                const handle = resolveSharedPropHandle(this.app, entityId);
                return handle ? handle : null;
            },
            reset: (target: string | ISharedPropHandle, pose: IPose, options?: IScenarioPropResetOptions) => {
                if (!this.app.isHost) return false;

                const handle = resolveSharedPropHandle(this.app, target);
                const entity = handle?.getEntity() ?? null;
                if (!entity) return false;

                entity.heldBy = null;
                entity.rigidBody.setTranslation(pose.position, true);
                entity.rigidBody.setRotation(pose.quaternion, true);

                const linearVelocity = options?.linearVelocity ?? { x: 0, y: 0, z: 0 };
                const angularVelocity = options?.angularVelocity ?? { x: 0, y: 0, z: 0 };
                entity.rigidBody.setLinvel(linearVelocity, true);
                entity.rigidBody.setAngvel(angularVelocity, true);

                this.app.runtime.physicsAuthority.noteAuthorityReason(
                    entity.id,
                    'scenario-reset',
                    entity.ownerId,
                    null
                );
                entity.ownerId = null;
                entity.syncAuthority();

                if (options?.wakeUp !== false) {
                    entity.rigidBody.wakeUp();
                }

                if (options?.forceSync !== false) {
                    this.app.runtime.network?.syncEntityNow(entity.id, true);
                }

                return true;
            },
            syncNow: (target: string | ISharedPropHandle, forceFullState?: boolean) => {
                const handle = resolveSharedPropHandle(this.app, target);
                if (!handle) return false;
                this.app.runtime.network?.syncEntityNow(handle.entityId, !!forceFullState);
                return true;
            }
        };

        this.physics = {
            ensureGround: (_size?: number) => {
                this.session.ensureGroundPhysics();
            },
            createStaticBox: (options: IScenarioStaticBoxOptions) => {
                const collider = this.app.runtime.physics.createStaticCuboidCollider(
                    options.halfExtents.x,
                    options.halfExtents.y,
                    options.halfExtents.z,
                    options.position,
                    options.rotation
                );
                if (!collider) return null;
                const id = options.id || `scenario-static-body-${this.nextStaticBodyId++}`;
                return new ScenarioStaticBodyHandle(id, this.app, collider);
            },
            createStaticHeightfield: (options: IScenarioStaticHeightfieldOptions) => {
                const collider = this.app.runtime.physics.createStaticHeightfield(
                    options.nrows,
                    options.ncols,
                    options.heights,
                    options.scale
                );
                if (!collider) return null;
                const id = options.id || `scenario-static-body-${this.nextStaticBodyId++}`;
                return new ScenarioStaticBodyHandle(id, this.app, collider);
            },
            removeBody: (target: IScenarioStaticBodyHandle | IPhysicsColliderHandle | null | undefined) => {
                if (!target) return;
                if ('destroy' in target && typeof target.destroy === 'function') {
                    target.destroy();
                    return;
                }
                this.app.runtime.physics.removeRigidBody((target as IPhysicsColliderHandle).body);
            }
        };

        this.actions = {
            request: (actionId: string, payload?: unknown) => {
                this.app.runtime.network.requestScenarioAction(actionId, payload);
            },
            setSessionConfig: (patch: Parameters<IScenarioContext['actions']['setSessionConfig']>[0]) => {
                this.app.runtime.network.requestSessionConfigUpdate(patch);
            },
            isHost: () => this.app.isHost
        };

        this.events = {
            emitScenario: (eventType: string, data: unknown, options?: IScenarioReplicationEmitOptions) => {
                this.session.emitScenarioEvent(eventType, data, options);
            }
        };

        this.timers = {
            nowMs: () => this.nowMs()
        };

        this.random = {
            float: () => this.session.randomFloat()
        };
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
                console.error('[ScenarioRuntimeContext] Cleanup callback failed:', error);
            }
        }
    }

    private getPlayerHandle(peerId: string): IScenarioPlayerHandle | null {
        const entity = this.app.runtime.entity.getEntity(peerId);
        if (!entity || entity.type !== EntityType.PLAYER_AVATAR) return null;
        return new ScenarioPlayerHandle(this.app, peerId);
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}

function compactPlayerId(playerId: string): string {
    if (playerId.length <= 10) return playerId;
    return `${playerId.slice(0, 4)}...${playerId.slice(-4)}`;
}



