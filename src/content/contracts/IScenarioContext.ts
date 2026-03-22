import * as THREE from 'three';
import type { ISessionConfig } from '../../app/AppContext';
import type { IPose, IQuaternion, IVector3 } from '../../shared/contracts/IMath';
import type { IObjectSpawnConfig } from './IObjectModule';
import type { IScenarioReplicationEmitOptions } from './IReplicatedScenarioModule';
import type { ISpawnedObjectInstance } from './ISpawnedObjectInstance';
import type { IAudioApi, IPhysicsColliderHandle, ISharedPropHandle } from './IObjectRuntimeContext';

export interface IScenarioPlayerHandle {
    readonly id: string;
    getDisplayName(): string;
    isLocal(): boolean;
}

export interface IScenarioPlayerTeleportOptions {
    targetSpace?: 'player' | 'head';
}

export interface IScenarioPropResetOptions {
    linearVelocity?: IVector3;
    angularVelocity?: IVector3;
    wakeUp?: boolean;
    forceSync?: boolean;
}

export interface IScenarioStaticBodyHandle {
    readonly id: string;
    destroy(): void;
}

export interface IScenarioStaticBoxOptions {
    id?: string;
    position: IVector3;
    halfExtents: IVector3;
    rotation?: IQuaternion;
}

export interface IScenarioStaticHeightfieldOptions {
    id?: string;
    nrows: number;
    ncols: number;
    heights: Float32Array;
    scale: IVector3;
}

export interface IScenarioContext {
    scene: {
        add(object: THREE.Object3D): void;
        remove(object: THREE.Object3D): void;
        isRenderingAvailable(): boolean;
        getCamera(): THREE.Camera | null;
        getRenderer(): THREE.WebGLRenderer | null;
        getRoot(): THREE.Scene | null;
        getGlobalUniforms(): { [key: string]: THREE.IUniform } | null;
    };

    assets: {
        getNormalizedModel(url: string, targetSize?: number): Promise<THREE.Group>;
        loadGLTF(url: string): Promise<THREE.Group>;
        loadTexture(url: string): Promise<THREE.Texture>;
    };

    audio: IAudioApi;

    players: {
        getLocal(): IScenarioPlayerHandle | null;
        get(peerId: string): IScenarioPlayerHandle | null;
        getAll(): IScenarioPlayerHandle[];
        teleport(
            target: string | IScenarioPlayerHandle,
            position: IVector3,
            yaw: number,
            options?: IScenarioPlayerTeleportOptions
        ): boolean;
        getDisplayName(target: string | IScenarioPlayerHandle): string;
    };

    objects: {
        spawn(moduleId: string, config?: IObjectSpawnConfig): ISpawnedObjectInstance | null;
        get(instanceId: string): ISpawnedObjectInstance | undefined;
        getFirstByModuleId(moduleId: string): ISpawnedObjectInstance | undefined;
        remove(instanceId: string): void;
    };

    props: {
        get(entityId: string): ISharedPropHandle | null;
        reset(
            target: string | ISharedPropHandle,
            pose: IPose,
            options?: IScenarioPropResetOptions
        ): boolean;
        syncNow(target: string | ISharedPropHandle, forceFullState?: boolean): boolean;
    };

    physics: {
        ensureGround(size?: number): void;
        createStaticBox(options: IScenarioStaticBoxOptions): IScenarioStaticBodyHandle | null;
        createStaticHeightfield(options: IScenarioStaticHeightfieldOptions): IScenarioStaticBodyHandle | null;
        removeBody(target: IScenarioStaticBodyHandle | IPhysicsColliderHandle | null | undefined): void;
    };

    actions: {
        request(actionId: string, payload?: unknown): void;
        setSessionConfig(patch: Partial<ISessionConfig>): void;
        isHost(): boolean;
    };

    events: {
        emitScenario(eventType: string, data: unknown, options?: IScenarioReplicationEmitOptions): void;
    };

    timers: {
        nowMs(): number;
    };

    random: {
        float(): number;
    };

    onCleanup(cleanup: () => void): void;
}
