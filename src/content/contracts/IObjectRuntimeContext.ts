import * as THREE from 'three';
import type { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import type { ITrackingState } from '../../shared/contracts/ITrackingProvider';
import type { IPose, IQuaternion, IVector3 } from '../../shared/contracts/IMath';
import type { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import type { PhysicsReplicationProfileId } from '../../physics/runtime/PhysicsReplicationProfiles';
import type { IObjectSpawnConfig } from './IObjectModule';
import type { IObjectReplicationEmitOptions } from './IReplicatedObjectInstance';
import type { ISpawnedObjectInstance } from './ISpawnedObjectInstance';

export interface IPhysicsBodyHandle {
    readonly id: number;
}

export interface IPhysicsColliderHandle {
    readonly id: number;
    readonly body: IPhysicsBodyHandle | null;
}

export interface ISharedPropHandle {
    readonly id: string;
    readonly entityId: string;
    isAuthority(): boolean;
    getOwnerId(): string | null;
    getHeldBy(): string | null;
    isSleeping(): boolean;
    getPosition(): IVector3 | null;
    getLinearVelocity(): IVector3 | null;
    getAngularVelocity(): IVector3 | null;
    requestControl(options?: { allowSpeculativeHostClaim?: boolean }): boolean;
    releaseControl(velocity?: IVector3): void;
    setMotion(options: {
        linearVelocity?: IVector3;
        angularVelocity?: IVector3;
        wakeUp?: boolean;
        forceSync?: boolean;
    }): boolean;
    setPose(options: {
        position: IVector3;
        quaternion: IQuaternion;
        linearVelocity?: IVector3;
        angularVelocity?: IVector3;
        wakeUp?: boolean;
        forceSync?: boolean;
    }): boolean;
    setBaseHalfExtents(halfExtents: IVector3): void;
    setUniformScale(scale: number): void;
    syncNow(forceFullState?: boolean): void;
    destroy(): void;
}

export interface ISharedPropInteractionConfig {
    onUse?: (event: IInteractionEvent, handle: ISharedPropHandle) => void;
    onGrab?: (playerId: string, hand: 'left' | 'right', handle: ISharedPropHandle) => void;
    onRelease?: (velocity: IVector3 | undefined, handle: ISharedPropHandle) => void;
    getCanonicalGrabOffset?: (hand: 'left' | 'right', handle: ISharedPropHandle) => IPose | undefined;
    getPreferredHeldQuaternionSpace?: (handle: ISharedPropHandle) => 'grip' | 'aim' | undefined;
}

export interface ISharedPropPhysicsTuning {
    linearDamping?: number;
    angularDamping?: number;
    friction?: number;
    restitution?: number;
    density?: number;
    gravityScale?: number;
    canSleep?: boolean;
    startSleeping?: boolean;
}

interface ISharedPropSpawnBase {
    position: IVector3;
    mesh: THREE.Object3D;
    ownerId?: string | null;
    url?: string;
    entityId?: string;
    grabbable?: boolean;
    physicsTuning?: ISharedPropPhysicsTuning;
    scale?: number;
    dualGrabScalable?: boolean;
    profile?: PhysicsReplicationProfileId;
    interaction?: ISharedPropInteractionConfig;
}

export interface IBoxSharedPropSpawnOptions extends ISharedPropSpawnBase {
    shape?: 'box';
    size?: number;
    halfExtents?: IVector3;
}

export interface ISphereSharedPropSpawnOptions extends ISharedPropSpawnBase {
    shape: 'sphere';
    radius?: number;
}

export type ISharedPropSpawnOptions =
    | IBoxSharedPropSpawnOptions
    | ISphereSharedPropSpawnOptions;

export interface ISharedPropRaycastHit {
    point: IVector3;
    normal: IVector3;
    distance: number;
    entityId: string | null;
    prop: ISharedPropHandle | null;
}

export interface ISharedPropImpulseOptions {
    linearFactor?: number;
    torqueFactor?: number;
}

export interface ICollisionStartedEvent {
    colliderAId: number;
    colliderBId: number;
    entityAId: string | null;
    entityBId: string | null;
    propA: ISharedPropHandle | null;
    propB: ISharedPropHandle | null;
}

export type TTriggerParticipantKind = 'player' | 'shared-prop';
export type TTriggerFilter = 'player' | 'shared-prop' | 'any';

export interface ITriggerParticipant {
    id: string;
    kind: TTriggerParticipantKind;
    entityId: string;
    playerId?: string;
    player?: PlayerAvatarEntity;
    prop?: ISharedPropHandle;
}

export interface ITriggerBoxOptions {
    id?: string;
    position: IVector3;
    halfExtents: IVector3;
    rotation?: IQuaternion;
    filter?: TTriggerFilter;
    enabled?: boolean;
}

export interface ITriggerZoneHandle {
    readonly id: string;
    setEnabled(enabled: boolean): void;
    destroy(): void;
    onEnter(callback: (participant: ITriggerParticipant) => void): () => void;
    onExit(callback: (participant: ITriggerParticipant) => void): () => void;
}

export interface IAudioApi {
    playDrumPadHit(options: { frequency: number; intensity: number; position?: { x: number; y: number; z: number } }): void;
    playSequencerBeat(options: {
        beat: 'kick' | 'snare' | 'hat' | 'bass';
        intensity?: number;
        position?: { x: number; y: number; z: number };
    }): void;
    playMelodyNote(options: {
        frequency: number;
        intensity?: number;
        position?: { x: number; y: number; z: number };
    }): void;
    playArpNote(options: {
        frequency: number;
        intensity?: number;
        brightness?: number;
        position?: { x: number; y: number; z: number };
    }): void;
    playFxSweep(options: {
        down?: boolean;
        intensity?: number;
        position?: { x: number; y: number; z: number };
    }): void;
}

export interface IObjectRuntimeContext {
    instanceId: string;

    scene: {
        add(object: THREE.Object3D): void;
        remove(object: THREE.Object3D): void;
        isRenderingAvailable(): boolean;
    };

    assets: {
        getNormalizedModel(url: string, targetSize?: number): Promise<THREE.Group>;
        loadGLTF(url: string): Promise<THREE.Group>;
        loadTexture(url: string): Promise<THREE.Texture>;
    };

    audio: IAudioApi;

    input: {
        getMovementVector(): { x: number; y: number };
        isInteractHeld(): boolean;
    };

    tracking: {
        getState(): ITrackingState;
        getLocalPlayer(): PlayerAvatarEntity | null;
    };

    players: {
        getLocal(): PlayerAvatarEntity | null;
        get(peerId: string): PlayerAvatarEntity | null;
    };

    actions: {
        request(actionId: string, payload?: unknown): void;
        isHost(): boolean;
    };

    props: {
        spawnShared(options: ISharedPropSpawnOptions): ISharedPropHandle | null;
        get(entityId: string): ISharedPropHandle | null;
        applyImpulse(
            target: string | ISharedPropHandle,
            impulse: IVector3,
            point: IVector3,
            options?: ISharedPropImpulseOptions
        ): boolean;
        raycast(origin: IVector3, direction: IVector3, maxDist: number): ISharedPropRaycastHit | null;
    };

    triggers: {
        createBox(options: ITriggerBoxOptions): ITriggerZoneHandle | null;
    };

    events: {
        onCollisionStarted(callback: (event: ICollisionStartedEvent) => void): () => void;
    };

    objects: {
        spawn(moduleId: string, config?: IObjectSpawnConfig): ISpawnedObjectInstance | null;
        get(instanceId: string): ISpawnedObjectInstance | undefined;
        getFirstByModuleId(moduleId: string): ISpawnedObjectInstance | undefined;
        remove(instanceId: string): void;
    };

    getLocalMountStatus(): import('./IMounting').ILocalMountStatus;
    requestLocalMount(options: import('./IMounting').ILocalMountBinding): boolean;
    grantLocalMount(options: import('./IMounting').ILocalMountBinding): boolean;
    rejectLocalMount(): void;
    releaseLocalMount(ownerInstanceId?: string, reason?: import('./IMounting').TLocalMountStateReason): void;
    mountLocal(options: import('./IMounting').ILocalMountBinding): boolean;
    unmountLocal(ownerInstanceId?: string, reason?: import('./IMounting').TLocalMountStateReason): void;
    isMountedLocal(ownerInstanceId?: string): boolean;

    onCleanup(cleanup: () => void): void;
}

export interface IInternalObjectSync {
    emit(eventType: string, data: Record<string, any>, options?: IObjectReplicationEmitOptions): void;
}
