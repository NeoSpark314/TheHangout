import type { AppContext } from '../../app/AppContext';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IVector3 } from '../../shared/contracts/IMath';

export interface IObjectSpawnConfig {
    id?: string;
    position?: IVector3;
    rotationY?: number;
    ownerId?: string | null;
    isAuthority?: boolean;
    [key: string]: unknown;
}

export interface IObjectModule {
    id: string;
    displayName: string;
    tags?: string[];
    networked?: boolean;
    portable?: boolean;

    spawn(context: AppContext, config: IObjectSpawnConfig): IEntity | null;
}
