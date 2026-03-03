import type { AppContext } from '../../app/AppContext';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { ISpawnedObjectInstance } from './ISpawnedObjectInstance';

export interface IObjectSpawnConfig {
    id?: string;
    position?: IVector3;
    rotationY?: number;
    ownerId?: string | null;
    isAuthority?: boolean;
    [key: string]: unknown;
}

export interface IObjectSpawnContext {
    app: AppContext;
    instanceId: string;
}

export type IObjectSpawnResult = ISpawnedObjectInstance | IEntity | null;

export interface IObjectModule {
    id: string;
    displayName: string;
    tags?: string[];
    networked?: boolean;
    portable?: boolean;

    spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): IObjectSpawnResult;
}
