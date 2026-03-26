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

        const entityId = id;
        const moduleId = typeof config.moduleId === 'string'
            ? config.moduleId
            : config.m;

        if (moduleId && typeof moduleId === 'string') {
            console.log(`[EntityRegistry] Discovering entity ${id} as part of object module: ${moduleId}`);
            const module = this.context.runtime.session?.getObjectModuleDefinition(moduleId);
            if (!module) {
                console.warn(`[EntityRegistry] Cannot discover unknown object module from network state: ${moduleId}`);
                return null;
            }
            if (module.networked === false) {
                console.warn(`[EntityRegistry] Ignoring non-networked object module from network state: ${moduleId}`);
                return null;
            }
            const instanceId = entityId;
            // Check if it's already being handled by a spawned instance to avoid loops
            const existingInstance = this.context.runtime.session?.getObjectInstance(instanceId);
            if (existingInstance) {
                const primary = existingInstance.getPrimaryEntity?.();
                if (primary) return primary;
            }

            const spawnConfig: any = {
                id: instanceId,
                entityId,
                halfExtents: config.he ? { x: config.he[0], y: config.he[1], z: config.he[2] } : undefined,
                position: config.p ? { x: config.p[0], y: config.p[1], z: config.p[2] } : undefined,
                isAuthority: false,
                ownerId: config.ownerId,
                assetUrl: config.assetUrl ?? config.url,
                color: config.c,
                scale: config.scale ?? config.s
            };

            const instance = this.context.runtime.session?.spawnObjectInstance(moduleId, spawnConfig);
            if (instance) {
                return instance.getPrimaryEntity?.() || null;
            }

            console.warn(`[EntityRegistry] Failed to spawn object module instance for discovered entity: ${moduleId} (${id})`);
            return null;
        }

        const normalizedConfig = {
            ...config,
            moduleId,
            ownerId: config.ownerId,
            color: config.color ?? config.c,
            scale: config.scale ?? config.s
        };

        const entity = EntityFactory.spawn(this.context, type, id, normalizedConfig);

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
        const scenarioEpoch = this.context.sessionConfig.scenarioEpoch;
        for (const entity of this.entities.values()) {
            const networkable = entity as unknown as INetworkable<Partial<IEntityState>>;
            if (entity.isAuthority && !entity.isDestroyed && networkable.getNetworkState) {
                const state = networkable.getNetworkState(fullSync);
                if (state) {
                    states.push({
                        id: entity.id,
                        type: entity.type as EntityType,
                        scenarioEpoch,
                        state: state as IEntityState
                    });
                }
            }
        }
        return states;
    }

    public getWorldSnapshot(): IStateUpdatePacket[] {
        const states: IStateUpdatePacket[] = [];
        const scenarioEpoch = this.context.sessionConfig.scenarioEpoch;
        for (const entity of this.entities.values()) {
            const networkable = entity as unknown as INetworkable<Partial<IEntityState>>;
            if (!entity.isDestroyed && networkable.getNetworkState) {
                const state = networkable.getNetworkState(true);
                if (state) {
                    states.push({
                        id: entity.id,
                        type: entity.type as EntityType,
                        scenarioEpoch,
                        state: state as IEntityState
                    });
                }
            }
        }
        return states;
    }
}
