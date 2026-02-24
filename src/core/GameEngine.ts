import eventBus from './EventBus';
import gameState from './GameState';
import { EVENTS } from '../utils/Constants';

export class GameEngine {
    private isRunning: boolean = false;
    private lastTime: number = performance.now();

    constructor() {}

    public async initialize(): Promise<void> {
        console.log('[GameEngine] Initializing...');
        eventBus.on(EVENTS.SCENE_READY, () => {
            this.start();
        });
    }

    public start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        console.log('[GameEngine] Engine started.');

        if (gameState.managers.render) {
            gameState.managers.render.setAnimationLoop(this.loop.bind(this));
        } else {
            requestAnimationFrame(this.loop.bind(this));
        }
    }

    public stop(): void {
        this.isRunning = false;
    }

    private loop(currentTime?: number): void {
        if (!this.isRunning) return;

        if (currentTime === undefined) currentTime = performance.now();

        const delta = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        gameState.deltaTime = delta;

        this.update(delta);

        if (!gameState.managers.render) {
            requestAnimationFrame(this.loop.bind(this));
        }
    }

    private update(delta: number): void {
        if (gameState.managers.network) {
            gameState.managers.network.update(delta);
        }

        if (gameState.managers.input) {
            gameState.managers.input.update(delta);
        }

        if (gameState.managers.entity) {
            gameState.managers.entity.update(delta);
        }

        if (gameState.managers.physics) {
            gameState.managers.physics.step(delta);
        }

        if (gameState.managers.room) {
            gameState.managers.room.update(delta);
        }

        if (gameState.managers.hud) {
            gameState.managers.hud.update(delta);
        }

        if (gameState.managers.render) {
            gameState.managers.render.update(delta);
            gameState.managers.render.render();
        }

        if (gameState.managers.input) {
            gameState.managers.input.clearJustPressed();
        }
    }
}
