// managers/WorldManager.js
import * as THREE from 'three';
import gameState from '../core/GameState.js';

export class WorldManager {
    constructor() {
        this.initialized = false;
    }

    generateTestWorld() {
        // Core physics world is initialized in PhysicsManager.
        // Architectural physics (ground, walls) now managed by RoomManager to align with 'vibe' configs.
        this.initialized = true;
        console.log('[WorldManager] Initialized (Architecture moved to RoomManager)');
    }

    update(delta) {
        // We don't have active world ticks yet, but might later for procedural generation tearing
    }
}
