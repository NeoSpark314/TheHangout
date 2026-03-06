import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { IObjectSpawnConfig } from './IObjectModule';
import type { IObjectReplicationEmitOptions } from './IReplicatedObjectInstance';
import type { ISpawnedObjectInstance } from './ISpawnedObjectInstance';
import type { ILocalMountBinding, ILocalMountStatus, TLocalMountStateReason } from './IMounting';

export interface IPhysicsBodyHandle {
    readonly id: number;
}

export interface IPhysicsColliderHandle {
    readonly id: number;
    readonly body: IPhysicsBodyHandle | null;
}

export interface IObjectRuntimeContext {
    app: AppContext;
    instanceId: string;

    scene: {
        add(object: THREE.Object3D): void;
        remove(object: THREE.Object3D): void;
    };

    physics: {
        createStaticCuboidCollider(
            hx: number,
            hy: number,
            hz: number,
            position: IVector3,
            rotation?: { x: number; y: number; z: number; w: number }
        ): IPhysicsColliderHandle | null;
        registerInteractionCollider(collider: IPhysicsColliderHandle, target: unknown): void;
        unregisterInteractionCollider(collider: IPhysicsColliderHandle): void;
        removeRigidBody(body: IPhysicsBodyHandle | null | undefined): void;
    };

    audio: {
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
    };

    entity: {
        get(entityId: string): unknown;
    };

    tracking: {
        getState(): any;
        getLocalPlayer(): AppContext['localPlayer'];
    };

    sync: {
        emit(eventType: string, data: unknown, options?: IObjectReplicationEmitOptions): void;
    };

    mount: {
        requestLocalMount(options: ILocalMountBinding): boolean;
        grantLocalMount(options: ILocalMountBinding): boolean;
        rejectLocalMount(): void;
        releaseLocalMount(ownerInstanceId?: string, reason?: TLocalMountStateReason): void;
        mountLocal(options: ILocalMountBinding): boolean;
        unmountLocal(ownerInstanceId?: string, reason?: TLocalMountStateReason): void;
        isMountedLocal(ownerInstanceId?: string): boolean;
        getLocalMountStatus(): ILocalMountStatus;
    };

    objects: {
        spawn(moduleId: string, config?: IObjectSpawnConfig): ISpawnedObjectInstance | null;
        get(instanceId: string): ISpawnedObjectInstance | undefined;
        getFirstByModuleId(moduleId: string): ISpawnedObjectInstance | undefined;
        remove(instanceId: string): void;
    };

    onPhysicsCollisionStarted(
        callback: (data: { handleA: number; handleB: number; entityAId: string | null; entityBId: string | null }) => void
    ): () => void;

    onCleanup(cleanup: () => void): void;
}
