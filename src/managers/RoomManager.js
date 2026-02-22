// managers/RoomManager.js

import * as THREE from 'three';
import gameState from '../core/GameState.js';
import { EnvironmentManager } from './EnvironmentManager.js';
import { PropManager } from './PropManager.js';

/**
 * High-level orchestrator for the room.
 * Delegates actual creation and animation to EnvironmentManager and PropManager.
 */
export class RoomManager {
    constructor() {
        this.scene = null;
        this._seed = 0;

        this.environment = null;
        this.props = null;
    }

    /**
     * Seeded PRNG (mulberry32). Produces deterministic values 0..1 from this._seed.
     */
    random() {
        this._seed |= 0;
        this._seed = (this._seed + 0x6D2B79F5) | 0;
        let t = Math.imul(this._seed ^ (this._seed >>> 15), 1 | this._seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    init(scene) {
        this.scene = scene;
        const randomBound = this.random.bind(this);

        this.environment = new EnvironmentManager(scene, randomBound);
        this.props = new PropManager(scene, randomBound);

        this.applyConfig(gameState.roomConfig);
    }

    applyConfig(config) {
        if (!this.scene || !config) return;

        console.log('[RoomManager] Coordinating Room Config:', config);

        if (config.seed !== undefined) {
            this._seed = config.seed;
        }

        // Delegate to sub-managers
        this.environment.applyConfig(config);
        this.props.applyConfig(config);

        // Ground physics (Shared responsibility)
        if (gameState.managers.physics && !this.groundPhysics) {
            gameState.managers.physics.createGround(25);
            this.groundPhysics = true;
        }
    }

    update(delta) {
        if (this.environment) this.environment.update(delta);
        if (this.props) this.props.update(delta);
    }

    updateConfig(newConfig) {
        const oldSeed = gameState.roomConfig.seed;
        gameState.roomConfig = { ...gameState.roomConfig, ...newConfig };

        // If the seed changed, tear down procedural elements so they get rebuilt
        if (newConfig.seed !== undefined && newConfig.seed !== oldSeed) {
            this.clearProceduralElements();
        }

        this.applyConfig(gameState.roomConfig);
    }

    clearProceduralElements() {
        if (this.environment) this.environment.clearProcedural();
        if (this.props) this.props.clearProcedural();
    }

    getSpawnPoint(index) {
        const radius = 2.5;
        const angle = (index * (Math.PI / 4)) + Math.PI;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;
        const yaw = angle;

        return {
            position: new THREE.Vector3(x, 0.2, z),
            yaw: yaw
        };
    }
}
