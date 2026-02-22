// entities/NetworkEntity.js
/**
 * UNIFIED ENTITY PATTERN
 * ═══════════════════════
 * Every entity that exists in the synced game world extends this class.
 * Each subclass handles BOTH roles in a single class via `isAuthority`:
 *
 *   Authority (isAuthority = true):
 *     - This client "owns" the entity and simulates it (physics, input, AI, etc.)
 *     - getNetworkState() serializes the entity's current state for broadcast
 *     - update() drives the entity from local sources (camera, input, physics engine)
 *
 *   Non-Authority (isAuthority = false):
 *     - Another client owns this entity; we just render it
 *     - setNetworkState(state) applies received state (snap or interpolation target)
 *     - update() interpolates visuals toward the received target state
 *
 * Authority can TRANSFER at runtime (e.g., grab transfers a prop from host to grabber).
 * The SAME mesh and visual setup are used in both modes.
 *
 * This pattern means adding a new synced entity (gun, vehicle, NPC) requires only:
 *   1. Extend NetworkEntity
 *   2. Implement getNetworkState() / setNetworkState() / update()
 *   3. Register with EntityManager — sync happens automatically
 *
 * Canonical example: PhysicsEntity, SpectatorEntity
 * Current exception: LocalPlayer / RemotePlayer (split justified by complexity;
 *   350+ lines of VR tracking & skills vs 200 lines of interpolation)
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
