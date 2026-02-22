// managers/PropManager.js

import * as THREE from 'three';
import { EntityFactory } from '../factories/EntityFactory.js';
import gameState from '../core/GameState.js';

/**
 * Handles local interactive objects and furniture in the room.
 * Responsible for:
 * - Table & Hologram
 * - Podest (Platform) & Decorations
 * - Spawning grabbable objects
 */
export class PropManager {
    constructor(scene, randomFunc) {
        this.scene = scene;
        this.random = randomFunc;

        this.table = null;
        this.hologram = null;
        this.podest = null;
        this.decorations = null;
        this.grabbablesSpawned = false;
    }

    applyConfig(config) {
        if (!config) return;

        if (!this.table) this.createTable();
        if (!this.hologram) this.createHologram();
        if (!this.podest) this.createPodest();
        if (!this.decorations) this.createDecorations();
        if (!this.grabbablesSpawned) this.createGrabbables();
    }

    update(delta) {
        // Animate Hologram
        if (this.hologram) {
            this.hologram.rotation.y += delta * 1.5;
            this.hologram.rotation.z += delta * 0.5;
            this.hologram.position.y = 0.5 + Math.sin(Date.now() * 0.002) * 0.05;
        }
    }

    createTable() {
        const tableGroup = new THREE.Group();

        const topGeo = new THREE.CylinderGeometry(2, 2, 0.1, 6);
        const topMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            emissive: 0x001133,
            metalness: 0.9,
            roughness: 0.4
        });
        this.table = new THREE.Mesh(topGeo, topMat);
        this.table.position.y = 1.0;
        tableGroup.add(this.table);

        const edges = new THREE.EdgesGeometry(topGeo);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff });
        const outline = new THREE.LineSegments(edges, lineMat);
        this.table.add(outline);

        const coreGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 6);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.y = 0.05;
        this.table.add(core);

        const baseGeo = new THREE.CylinderGeometry(0.3, 0.8, 1.0, 6);
        const baseMat = new THREE.MeshBasicMaterial({ color: 0x0a0a1a });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.5;
        tableGroup.add(base);

        this.scene.add(tableGroup);

        if (gameState.managers.physics) {
            gameState.managers.physics.createHexagon(2.0, 0.5, { x: 0, y: 0.8, z: 0 }, tableGroup, true);
            gameState.managers.physics.createCuboid(0.4, 0.45, 0.4, { x: 0, y: 0.45, z: 0 }, null, true);
        }
    }

    createHologram() {
        if (!this.table) return;

        const holoGeo = new THREE.IcosahedronGeometry(0.35, 1);
        const holoMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            wireframe: true,
            transparent: true,
            opacity: 0.5
        });

        this.hologram = new THREE.Mesh(holoGeo, holoMat);
        this.hologram.position.y = 0.5;
        this.table.add(this.hologram);
    }

    createPodest() {
        this.podest = new THREE.Group();
        const cubeSize = 1.0;

        const podestMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a20,
            metalness: 0.8,
            roughness: 0.5,
            emissive: 0x000510
        });

        const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 });
        const blockGeo = new THREE.BoxGeometry(cubeSize, 0.2, cubeSize);

        for (let x = -4; x < 4; x++) {
            for (let z = -4; z < 4; z++) {
                const hOffset = this.random() * 0.05;
                const segment = new THREE.Mesh(blockGeo, podestMat);
                segment.position.set(x + 0.5, 0.1 + hOffset, z + 0.5);

                const segmentEdges = new THREE.EdgesGeometry(blockGeo);
                const segmentOutline = new THREE.LineSegments(segmentEdges, wireMat);
                segment.add(segmentOutline);

                this.podest.add(segment);
            }
        }

        this.scene.add(this.podest);

        if (gameState.managers.physics) {
            gameState.managers.physics.createCuboid(4.0, 0.1, 4.0, { x: 0, y: 0.1, z: 0 }, this.podest, true);
        }
    }

    createDecorations() {
        this.decorations = new THREE.Group();
        const pillarCount = 12;
        const radius = 6.0;

        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x050515,
            metalness: 0.9,
            roughness: 0.1,
            emissive: 0x001122
        });
        const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.4 });

        for (let i = 0; i < pillarCount; i++) {
            const angle = (i / pillarCount) * Math.PI * 2;
            const h = 0.5 + this.random() * 2.5;
            const w = 0.4 + this.random() * 0.6;

            const geo = new THREE.BoxGeometry(w, h, w);
            const pillar = new THREE.Mesh(geo, pillarMat);

            pillar.position.set(
                Math.sin(angle) * (radius + this.random() * 2),
                h / 2,
                Math.cos(angle) * (radius + this.random() * 2)
            );

            const edges = new THREE.EdgesGeometry(geo);
            const outline = new THREE.LineSegments(edges, wireMat);
            pillar.add(outline);

            this.decorations.add(pillar);
        }

        this.scene.add(this.decorations);
    }

    createGrabbables() {
        const physics = gameState.managers.physics;
        if (!physics || !this.scene) return;

        this.grabbablesSpawned = true;

        const cubeSize = 0.12;
        const cubeCount = 6;
        const tableRadius = 1.0;
        const tableY = 1.15;

        const colors = [0xff0055, 0x00ff88, 0x5500ff, 0xff8800, 0x00ccff, 0xffff00];

        for (let i = 0; i < cubeCount; i++) {
            const angle = (i / cubeCount) * Math.PI * 2;
            const x = Math.sin(angle) * tableRadius;
            const z = Math.cos(angle) * tableRadius;
            const position = { x, y: tableY, z };

            const geo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
            const mat = new THREE.MeshStandardMaterial({
                color: colors[i],
                emissive: colors[i],
                emissiveIntensity: 0.3,
                metalness: 0.6,
                roughness: 0.3
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, tableY, z);

            const edges = new THREE.EdgesGeometry(geo);
            const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
            mesh.add(new THREE.LineSegments(edges, lineMat));

            EntityFactory.createGrabbable(`grabbable-${i}`, cubeSize, position, mesh);
        }
    }

    clearProcedural() {
        const remove = (obj) => {
            if (!obj) return;
            this.scene.remove(obj);
            obj.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
        };

        remove(this.podest);
        remove(this.decorations);
        this.podest = null;
        this.decorations = null;
    }
}
