import type { IEntity } from '../../shared/contracts/IEntity';
import type { IUpdatable } from '../../shared/contracts/IUpdatable';

export interface ISpawnedObjectInstance extends IUpdatable {
    id: string;
    moduleId: string;

    getPrimaryEntity?(): IEntity | null;
    getOwnedEntityIds?(): string[];

    destroy(): void;
}
