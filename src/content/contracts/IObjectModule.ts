import type { IEntity } from '../../shared/contracts/IEntity';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { ISpawnedObjectInstance } from './ISpawnedObjectInstance';
import type { IObjectRuntimeContext } from './IObjectRuntimeContext';

export interface IObjectSpawnConfig {
    id?: string;
    entityId?: string;
    position?: IVector3;
    rotationY?: number;
    ownerId?: string | null;
    isAuthority?: boolean;
    size?: number;
    color?: number;
    assetUrl?: string;
    url?: string;
    halfExtents?: IVector3;
    scale?: number;
}

export type IObjectSpawnContext = IObjectRuntimeContext;

export type IObjectSpawnResult = ISpawnedObjectInstance | IEntity | null;

export interface IObjectModule {
    id: string;
    displayName: string;
    tags?: string[];
    networked?: boolean;
    portable?: boolean;

    spawn(context: IObjectRuntimeContext, config: IObjectSpawnConfig): IObjectSpawnResult;
}

