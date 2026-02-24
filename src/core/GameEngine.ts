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
            gameState.managers.render.setAnimationLoop((time, frame) => this.loop(time, frame));
        } else {
            const wrap = (time: number) => {
                this.loop(time);
                if (this.isRunning) requestAnimationFrame(wrap);
            };
            requestAnimationFrame(wrap);
        }
    }

    public stop(): void {
        this.isRunning = false;
    }

    private loop(currentTime: number, frame?: XRFrame): void {
        if (!this.isRunning) return;

        const delta = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        gameState.deltaTime = delta;

        this.update(delta, frame);
    }

    private update(delta: number, frame?: XRFrame): void {
        if (gameState.managers.network) {
            gameState.managers.network.update(delta);
        }

        if (gameState.managers.input) {
            gameState.managers.input.update(delta, frame);
        }

        if (gameState.managers.entity) {
            gameState.managers.entity.update(delta, frame);
        }

        if (gameState.managers.physics) {
            gameState.managers.physics.step(delta);
        }

        if (gameState.managers.room) {
            gameState.managers.room.update(delta);
        }

        if (gameState.managers.ui) {
            gameState.managers.ui.update(delta);
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
