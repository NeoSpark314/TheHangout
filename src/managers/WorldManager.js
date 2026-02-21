// managers/WorldManager.js
import * as THREE from 'three';
import gameState from '../core/GameState.js';

export class WorldManager {
    constructor() {
        this.initialized = false;
    }

    generateTestWorld() {
        const { physics } = gameState.managers;

        if (!physics || !physics.rapierLoaded) return;

        // Ground physics collider (Visuals handled by RoomManager)
        physics.createGround(25); // 25 is half-extent of 50

        this.initialized = true;
        console.log('[WorldManager] World physics initialized');
    }

    update(delta) {
        // We don't have active world ticks yet, but might later for procedural generation tearing
    }
}
