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

        // 1. Create Floor Material
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x555555,
            roughness: 0.8
        });

        const floorGeometry = new THREE.BoxGeometry(50, 0.2, 50);
        const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
        floorMesh.position.y = -0.1; // Offset so top is at y=0
        floorMesh.receiveShadow = true;

        render.add(floorMesh);
        physics.createGround(25); // 25 is half-extent of 50

        // 2. Create some dynamic boxes for testing
        const boxMaterial = new THREE.MeshStandardMaterial({
            color: 0xef4444, // Red
            roughness: 0.5
        });

        const boxSize = 1;
        const boxGeometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);

        for (let i = 0; i < 50; i++) {
            const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
            boxMesh.castShadow = true;
            boxMesh.receiveShadow = true;
            render.add(boxMesh);

            // Random position above the floor
            const startPos = {
                x: (Math.random() - 0.5) * 10,
                y: 5 + Math.random() * 10,
                z: (Math.random() - 0.5) * 10
            };

            physics.createBox(boxSize, startPos, boxMesh);
        }

        this.initialized = true;
        console.log('[WorldManager] Test world generated');
    }

    update(delta) {
        // We don't have active world ticks yet, but might later for procedural generation tearing
    }
}
