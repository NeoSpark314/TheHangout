// core/GameEngine.js
import eventBus from './EventBus.js';
import gameState from './GameState.js';
import { EVENTS } from '../utils/Constants.js';

export class GameEngine {
    constructor() {
        this.isRunning = false;
        this.lastTime = performance.now();
    }

    /**
     * Initializes the engine and all managers.
     */
    async initialize() {
        console.log('[GameEngine] Initializing...');

        // We will instantiate managers here later.
        // For now, we prepare the loop.

        eventBus.on(EVENTS.SCENE_READY, () => {
            this.start();
        });
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        console.log('[GameEngine] Engine started.');

        // Use RenderManager's setAnimationLoop for WebXR compatibility
        if (gameState.managers.render) {
            this.loop = this.loop.bind(this);
            gameState.managers.render.setAnimationLoop(this.loop);
        } else {
            this.loop = this.loop.bind(this);
            requestAnimationFrame(this.loop);
        }
    }

    stop() {
        this.isRunning = false;
    }

    loop(currentTime) {
        if (!this.isRunning) return;

        // If currentTime is not provided (unlikely with setAnimationLoop but safe)
        if (currentTime === undefined) currentTime = performance.now();

        // Calculate delta time in seconds
        const delta = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        gameState.deltaTime = delta;

        this.update(delta);

        // No need to call requestAnimationFrame manually when using setAnimationLoop
        if (!gameState.managers.render) {
            requestAnimationFrame(this.loop);
        }
    }

    /**
     * Main game loop sequence
     * 1. Network Processing (Apply remote states)
     * 2. Input Gathering (Player intent)
     * 3. Physics Step (Host simulation)
     * 4. State Sync (Rapier -> Three)
     * 5. Render (Draw scene)
     */
    update(delta) {
        // 1. Network
        if (gameState.managers.network) {
            gameState.managers.network.update(delta);
        }

        // 2. Input / Player
        if (gameState.managers.input) {
            gameState.managers.input.update(delta);
        }

        // 3. Physics
        if (gameState.managers.physics) {
            gameState.managers.physics.step(delta);
        }

        // 4. World & Entity State Sync
        if (gameState.managers.world) {
            gameState.managers.world.update(delta);
        }

        // 5. Update All Entities Locally
        if (gameState.managers.entity) {
            gameState.managers.entity.update(delta);
        }

        // 6. HUD
        if (gameState.managers.hud) {
            gameState.managers.hud.update(delta);
        }

        // 7. Render
        if (gameState.managers.render) {
            gameState.managers.render.update(delta);
            gameState.managers.render.render();
        }
    }
}
