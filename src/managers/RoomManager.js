// managers/RoomManager.js
import * as THREE from 'three';
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { PACKET_TYPES } from '../utils/Constants.js';

export class RoomManager {
    constructor() {
        this.scene = null;
    }

    init(scene) {
        this.scene = scene;
        this.applyConfig(gameState.roomConfig);
    }

    applyConfig(config) {
        if (!this.scene || !config) return;

        console.log('[RoomManager] Applying Room Config:', config);

        // Update Background
        if (config.skyColor) {
            this.scene.background = new THREE.Color(config.skyColor);
        }

        // Update Fog (Shifted for Distant Horizon)
        if (config.skyColor) {
            const fogNear = config.fogNear || 10;
            const fogFar = config.fogFar || 1000; // Much further to see the mountains

            if (!this.scene.fog) {
                this.scene.fog = new THREE.Fog(config.skyColor, fogNear, fogFar);
            } else {
                this.scene.fog.color.set(config.skyColor);
                this.scene.fog.near = fogNear;
                this.scene.fog.far = fogFar;
            }
        }

        // Create the environment if not already there
        if (!this.table) {
            this.createTable();
        }

        if (!this.hills) {
            this.createDistantHills();
        }
    }

    createDistantHills() {
        if (!this.scene) return;

        this.hills = new THREE.Group();
        const hillCount = 24;
        const radius = 400;
        const hillScale = 80;

        // Use a single material for performance
        const mountainMat = new THREE.MeshPhongMaterial({
            color: 0x100520, // Dark galactic purple
            emissive: 0x330066, // Brighter glow
            shininess: 10,
            flatShading: true
        });

        const wireMat = new THREE.LineBasicMaterial({
            color: 0xbb00ff, // Brighter neon
            transparent: true,
            opacity: 0.5 // Higher opacity
        });

        for (let i = 0; i < hillCount; i++) {
            const angle = (i / hillCount) * Math.PI * 2;

            // Randomized peaks
            const h = 20 + Math.random() * hillScale;
            const w = 40 + Math.random() * 60;

            // ConeGeometry creates a perfect pyramid/peak
            const geo = new THREE.ConeGeometry(w, h, 4); // 4 radial segments = pyramid
            const mountain = new THREE.Mesh(geo, mountainMat);

            // Position in a ring
            mountain.position.set(
                Math.sin(angle) * radius,
                h / 2 - 5, // Lower slightly into the ground
                Math.cos(angle) * radius
            );

            // Random rotation for variety
            mountain.rotation.y = Math.random() * Math.PI;

            // Wireframe overlay for synthwave style
            const edges = new THREE.EdgesGeometry(geo);
            const outline = new THREE.LineSegments(edges, wireMat);
            mountain.add(outline);

            this.hills.add(mountain);
        }

        this.scene.add(this.hills);
        console.log('[RoomManager] Distant mountains generated');
    }

    createTable() {
        if (!this.scene) return;

        // Cyber-Stube Meeting Table
        const tableGroup = new THREE.Group();

        // Table Top (Hexagon or Large Disc)
        const topGeo = new THREE.CylinderGeometry(2, 2, 0.1, 6); // Hexagonal table
        const topMat = new THREE.MeshPhongMaterial({
            color: 0x1a1a2e, // Deep navy/galactic blue
            emissive: 0x001133,
            shininess: 100
        });
        this.table = new THREE.Mesh(topGeo, topMat);
        this.table.position.y = 1.0; // Comfortably standing height (was 0.75)
        tableGroup.add(this.table);

        // Neon Edge for Table
        const edges = new THREE.EdgesGeometry(topGeo);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff });
        const outline = new THREE.LineSegments(edges, lineMat);
        this.table.add(outline);

        // Central "Data Hub" (Glowing core)
        const coreGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 6);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.y = 0.05;
        this.table.add(core);

        // Core outline
        const coreEdges = new THREE.EdgesGeometry(coreGeo);
        const coreOutline = new THREE.LineSegments(coreEdges, lineMat);
        core.add(coreOutline);

        // Leg/Base
        const baseGeo = new THREE.CylinderGeometry(0.3, 0.8, 1.0, 6);
        const baseMat = new THREE.MeshBasicMaterial({ color: 0x0a0a1a });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 1.0 / 2; // Sits on origin
        tableGroup.add(base);

        this.scene.add(tableGroup);
        console.log('[RoomManager] Meeting table created');

        // Add to physics also if we want them to bump into it
        if (gameState.managers.physics) {
            // Create a static hexagonal area physics (approximated by a box of radius sized 4x1x4)
            // Height is 1.0
            gameState.managers.physics.createBox(4, { x: 0, y: 0.5, z: 0 }, tableGroup, true);
        }
    }

    /**
     * Calculates a spawn position and rotation for a player around the table.
     * @param {number} index - The participant index (0 = Host, 1+ = Guests)
     */
    getSpawnPoint(index) {
        const radius = 2.5;
        // Start from "South" (front) and go around
        const angle = (index * (Math.PI / 4)) + Math.PI;

        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;

        // Face the center (table)
        const yaw = angle;

        return {
            position: new THREE.Vector3(x, 0, z),
            yaw: yaw
        };
    }

    /**
     * Called by NetworkManager when a ROOM_CONFIG_UPDATE packet is received.
     */
    updateConfig(newConfig) {
        gameState.roomConfig = { ...gameState.roomConfig, ...newConfig };
        this.applyConfig(gameState.roomConfig);
    }
}
