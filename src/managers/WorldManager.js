// managers/WorldManager.js
import * as THREE from 'three';
import gameState from '../core/GameState.js';

export class WorldManager {
    constructor() {
        this.initialized = false;
    }

    generateTestWorld() {
        const { render, physics } = gameState.managers;

        if (!render || !physics || !physics.rapierLoaded) return;

        // 1. Create Floor Material (Dark space base)
        const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x050510 });
        const floorGeometry = new THREE.BoxGeometry(50, 0.2, 50);
        const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
        floorMesh.position.y = -0.1; // Offset so top is at y=0
        render.add(floorMesh);

        // Add Retro Neon Grid
        const gridHelper = new THREE.GridHelper(50, 25, 0xff00ff, 0x00ffff); // Magenta center, Cyan outer
        gridHelper.position.y = 0.01; // Slightly above floor to prevent z-fighting
        render.add(gridHelper);
        physics.createGround(25); // 25 is half-extent of 50

        physics.createGround(25); // 25 is half-extent of 50

        this.initialized = true;
        console.log('[WorldManager] Test world generated (Cubes removed)');
    }

    update(delta) {
        // We don't have active world ticks yet, but might later for procedural generation tearing
    }
}
