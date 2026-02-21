// entities/NetworkEntity.js

/**
 * Base class/interface for all entities that exist in the synced game world.
 */
export class NetworkEntity {
    constructor(id, type, isAuthority = false) {
        this.id = id;
        this.type = type; // e.g. 'LOCAL_PLAYER', 'REMOTE_PLAYER', 'PHYSICS_PROP'

        // Indicates if this local client is simulating this entity and should broadcast its state.
        this.isAuthority = isAuthority;
        this.destroyed = false;
    }

    /**
     * Called every frame by the GameEngine / EntityManager.
     * @param {number} delta - Time since last frame in seconds
     */
    update(delta) {
        // Implementation provided by subclasses
    }

    /**
     * Called by NetworkManager when fetching an authoritative entity's state to broadcast.
     * Only relevant if `isAuthority` is true.
     * @returns {Object} Serializable state needed to replicate this entity.
     */
    getNetworkState() {
        return null; // Implement in subclass
    }

    /**
     * Called by NetworkManager when receiving state updates from the authoritative client.
     * Only relevant if `isAuthority` is false.
     * @param {Object} state - Application specific state object
     */
    setNetworkState(state) {
        // Implement in subclass (e.g. interpolate positions, apply health changes)
    }

    /**
     * Called when the entity is removed from the game world.
     * Subclasses should clean up Three.js meshes, Rapier bodies, event listeners, etc.
     */
    destroy() {
        this.destroyed = true;
    }
}
