import { IEntity } from '../interfaces/IEntity';
import { INetworkable } from '../interfaces/INetworkable';

export class EntityManager {
    public entities: Map<string, IEntity>;

    constructor() {
        this.entities = new Map();
    }

    public addEntity(entity: IEntity): void {
        if (!entity || !entity.id) {
            console.error('[EntityManager] Attempted to add invalid entity:', entity);
            return;
        }

        if (this.entities.has(entity.id)) {
            console.warn(`[EntityManager] Entity with ID ${entity.id} already exists. Overwriting.`);
            const old = this.entities.get(entity.id);
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
            if (!entity.destroyed) {
                try {
                    entity.update(delta, frame);
                } catch (e) {
                    console.error(`[EntityManager] Error updating entity ${id}:`, e);
                }
            } else {
                this.entities.delete(id);
            }
        }
    }

    public getAuthoritativeStates(): any[] {
        const states: any[] = [];
        for (const entity of this.entities.values()) {
            const networkable = entity as unknown as INetworkable<any>;
            if (entity.isAuthority && !entity.destroyed && networkable.getNetworkState) {
                const state = networkable.getNetworkState();
                if (state) {
                    states.push({
                        id: entity.id,
                        type: entity.type,
                        state: state
                    });
                }
            }
        }
        return states;
    }

    public getWorldSnapshot(): any[] {
        const states: any[] = [];
        for (const entity of this.entities.values()) {
            const networkable = entity as unknown as INetworkable<any>;
            if (!entity.destroyed && networkable.getNetworkState) {
                const state = networkable.getNetworkState();
                if (state) {
                    states.push({
                        id: entity.id,
                        type: entity.type,
                        state: state
                    });
                }
            }
        }
        return states;
    }
}
