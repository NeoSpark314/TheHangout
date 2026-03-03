import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { IObjectSpawnConfig } from './IObjectModule';
import type { ISpawnedObjectInstance } from './ISpawnedObjectInstance';

export interface IObjectRuntimeContext {
    app: AppContext;
    instanceId: string;

    scene: {
        add(object: THREE.Object3D): void;
        remove(object: THREE.Object3D): void;
    };

    physics: {
        createStaticCuboidCollider(hx: number, hy: number, hz: number, position: IVector3): any | null;
        removeRigidBody(body: any): void;
    };

    audio: {
        playDrumPadHit(options: { frequency: number; intensity: number; position?: { x: number; y: number; z: number } }): void;
    };

    entity: {
        get(entityId: string): unknown;
    };

    tracking: {
        getState(): any;
        getLocalPlayer(): AppContext['localPlayer'];
    };

    sync: {
        emit(eventType: string, data: unknown): void;
    };

    mount: {
        mountLocal(options: {
            ownerInstanceId: string;
            getSeatPose: () => { position: THREE.Vector3; yaw: number };
            getExitPose?: () => { position: THREE.Vector3; yaw: number };
        }): boolean;
        unmountLocal(ownerInstanceId?: string): void;
        isMountedLocal(ownerInstanceId?: string): boolean;
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
