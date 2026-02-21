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

        // 2. Create some dynamic boxes for testing (Retro Wireframes)
        const boxMaterial = new THREE.MeshBasicMaterial({
            color: 0x050510 // Dark solid color matching the floor
        });

        const boxOutlineMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff }); // Neon Cyan

        const boxSize = 1;
        const boxGeometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
        const boxEdges = new THREE.EdgesGeometry(boxGeometry);

        for (let i = 0; i < 50; i++) {
            const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);

            // Add the glowing neon edge outline
            const outline = new THREE.LineSegments(boxEdges, boxOutlineMaterial);
            boxMesh.add(outline);

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
