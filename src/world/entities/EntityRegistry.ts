import { IEntity } from '../../shared/contracts/IEntity';
import { EntityType, IPlayerEntityState, IStateUpdatePacket, IEntityState } from '../../shared/contracts/IEntityState';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { INetworkable } from '../../shared/contracts/INetworkable';
import { EntityFactory } from '../spawning/EntityFactory';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { AppContext } from '../../app/AppContext';

export class EntityRegistry implements IUpdatable {
    public entities: Map<string, IEntity>;

    constructor(private context: AppContext) {
        this.entities = new Map();
    }

    public defaultType: string = 'unknown';

    public discover(id: string, type: string, config: Record<string, any> = {}): IEntity | null {
        if (this.entities.has(id)) return this.entities.get(id)!;

        console.log(`[EntityRegistry] Discovering new ${type} with ID: ${id}`);
        const entity = EntityFactory.spawn(this.context, type, id, config);

        if (entity) {
            this.addEntity(entity);
            eventBus.emit(EVENTS.ENTITY_DISCOVERED, id);
            return entity;
        }

        return null;
    }

    public addEntity(entity: IEntity): void {
        if (!entity || !entity.id) {
            console.error('[EntityRegistry] Attempted to add invalid entity:', entity);
            return;
        }

        if (this.entities.has(entity.id)) {
            const old = this.entities.get(entity.id);
            if (old === entity) return; // Ignore re-adding the exact same instance
            console.warn(`[EntityRegistry] Entity with ID ${entity.id} already exists. Overwriting.`);
            old?.destroy();
        }
        this.entities.set(entity.id, entity);
    }

    public removeEntity(id: string): void {
        const entity = this.entities.get(id);
        if (entity) {
            entity.destroy();
            this.entities.delete(id);
        }
    }

    public updateEntityId(oldId: string, newId: string): void {
        if (oldId === newId) return;
        const entity = this.entities.get(oldId);
        if (entity) {
            this.entities.delete(oldId);
            entity.id = newId;
            this.entities.set(newId, entity);
        }
    }

    public getEntity(id: string): IEntity | undefined {
        return this.entities.get(id);
    }

    public update(delta: number, frame?: XRFrame): void {
        for (const [id, entity] of this.entities.entries()) {
            if (!entity.isDestroyed) {
                try {
                    entity.update(delta, frame);
                } catch (e) {
                    console.error(`[EntityRegistry] Error updating entity ${id}:`, e);
                }
            } else {
                this.entities.delete(id);
            }
        }
    }

    public getAuthoritativeStates(fullSync: boolean = false): IStateUpdatePacket[] {
        const states: IStateUpdatePacket[] = [];
        for (const entity of this.entities.values()) {
            const networkable = entity as unknown as INetworkable<Partial<IEntityState>>;
            if (entity.isAuthority && !entity.isDestroyed && networkable.getNetworkState) {
                const state = networkable.getNetworkState(fullSync);
                if (state) {
                    states.push({
                        id: entity.id,
                        type: entity.type as EntityType,
                        state: state as IEntityState
                    });
                }
            }
        }
        return states;
    }

    public getWorldSnapshot(): IStateUpdatePacket[] {
        const states: IStateUpdatePacket[] = [];
        for (const entity of this.entities.values()) {
            const networkable = entity as unknown as INetworkable<Partial<IEntityState>>;
            if (!entity.isDestroyed && networkable.getNetworkState) {
                const state = networkable.getNetworkState(true);
                if (state) {
                    states.push({
                        id: entity.id,
                        type: entity.type as EntityType,
                        state: state as IEntityState
                    });
                }
            }
        }
        return states;
    }
}
