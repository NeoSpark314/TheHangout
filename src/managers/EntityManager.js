// managers/EntityManager.js
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class EntityManager {
    constructor() {
        this.entities = new Map(); // id -> NetworkEntity
    }

    /**
     * Register a new entity into the world simulation
     * @param {NetworkEntity} entity 
     */
    addEntity(entity) {
        if (!entity || !entity.id) {
            console.error('[EntityManager] Attempted to add invalid entity:', entity);
            return;
        }

        if (this.entities.has(entity.id)) {
            console.warn(`[EntityManager] Entity with ID ${entity.id} already exists. Overwriting.`);
            const old = this.entities.get(entity.id);
            old.destroy();
        }

        this.entities.set(entity.id, entity);
    }

    /**
     * Removes an entity and calls its destroy method
     * @param {string} id 
     */
    removeEntity(id) {
        const entity = this.entities.get(id);
        if (entity) {
            entity.destroy();
            this.entities.delete(id);
        }
    }

    /**
     * Updates an entity's ID dynamically
     * @param {string} oldId 
     * @param {string} newId 
     */
    updateEntityId(oldId, newId) {
        if (oldId === newId) return;
        const entity = this.entities.get(oldId);
        if (entity) {
            this.entities.delete(oldId);
            entity.id = newId;
            this.entities.set(newId, entity);
        }
    }

    /**
     * Retrieves an entity by its unique ID
     * @param {string} id 
     * @returns {NetworkEntity|undefined}
     */
    getEntity(id) {
        return this.entities.get(id);
    }

    /**
     * Updates all entities in the simulation visually and locally.
     * @param {number} delta 
     */
    update(delta) {
        for (const [id, entity] of this.entities.entries()) {
            if (!entity.destroyed) {
                try {
                    entity.update(delta);
                } catch (e) {
                    console.error(`[EntityManager] Error updating entity ${id}:`, e);
                }
            } else {
                this.entities.delete(id);
            }
        }
    }

    /**
     * Gets state for all entities this client has authority over
     * @returns {Array<Object>}
     */
    getAuthoritativeStates() {
        const states = [];
        for (const entity of this.entities.values()) {
            if (entity.isAuthority && !entity.destroyed) {
                const state = entity.getNetworkState();
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
