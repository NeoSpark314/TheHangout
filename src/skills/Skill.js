// skills/Skill.js

/**
 * Base class for all player skills/abilities.
 * Skills are modular tools that handle input, affect the world,
 * and can sync their effects over the network.
 */
export class Skill {
    /**
     * @param {string} id - Unique skill identifier (e.g. 'movement', 'draw', 'grab')
     * @param {string} name - Human-readable name
     * @param {object} options
     * @param {boolean} [options.alwaysActive=false] - If true, runs every frame regardless of selection
     */
    constructor(id, name, { alwaysActive = false } = {}) {
        this.id = id;
        this.name = name;
        this.alwaysActive = alwaysActive;
        this.isActive = false;
    }

    /**
     * Called when this skill becomes the active skill.
     * @param {LocalPlayer} player
     */
    activate(player) {
        this.isActive = true;
    }

    /**
     * Called when this skill is deactivated (another skill selected).
     * @param {LocalPlayer} player
     */
    deactivate(player) {
        this.isActive = false;
    }

    /**
     * Called every frame for active and always-on skills.
     * @param {number} delta - Time since last frame in seconds
     * @param {LocalPlayer} player
     */
    update(delta, player) {
        // Implement in subclass
    }

    /**
     * Returns network-syncable state for this skill's effects.
     * @returns {object|null}
     */
    getNetworkState() {
        return null;
    }

    /**
     * Applies incoming network state for this skill's effects (remote players).
     * @param {object} state
     */
    setNetworkState(state) {
        // Implement in subclass
    }

    /**
     * Cleanup when the skill is permanently removed.
     */
    destroy() {
        // Implement in subclass
    }
}
