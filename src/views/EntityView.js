// views/EntityView.js

/**
 * Base class for entity visuals. Subclass this to create new
 * visual representations for any entity type.
 *
 * Entity logic (physics, networking, input) stays in the entity.
 * How it LOOKS is handled here.
 *
 * Subclasses MUST:
 *   - Set `this.mesh` to a THREE.Object3D (or Group) in their constructor
 *   - Implement `update(state, delta)` to apply visual changes each frame
 *   - Implement `destroy()` to dispose GPU resources (geometries, materials, textures)
 *
 * Subclasses MAY:
 *   - Override `addToScene` / `removeFromScene` for custom attachment logic
 */
export class EntityView {
    constructor() {
        /** @type {THREE.Object3D|null} Root scene object for this visual */
        this.mesh = null;
    }

    /**
     * Called every frame by the entity's update().
     * @param {Object} state - Entity-specific state (position, rotation, etc.)
     * @param {number} delta - Time since last frame in seconds
     */
    update(state, delta) {
        // Implement in subclass
    }

    /**
     * Attach this visual to a Three.js scene.
     * @param {THREE.Scene} scene
     */
    addToScene(scene) {
        if (this.mesh) scene.add(this.mesh);
    }

    /**
     * Remove this visual from a Three.js scene.
     * @param {THREE.Scene} scene
     */
    removeFromScene(scene) {
        if (this.mesh) scene.remove(this.mesh);
    }

    /**
     * Clean up all GPU resources (geometries, materials, textures).
     * Called when the entity is destroyed.
     */
    destroy() {
        // Implement in subclass
    }
}
