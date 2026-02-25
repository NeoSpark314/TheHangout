import { EVENTS } from '../utils/Constants';
import { GameContext } from './GameState';
import { IUpdatable } from '../interfaces/IUpdatable';

/**
 * The core simulation runner for the application.
 * Executes all registered systems (IUpdatable) each frame.
 */
export class GameEngine {
    private isRunning: boolean = false;
    private lastTime: number = performance.now();
    private updateSystems: IUpdatable[] = [];
    private endFrameCallbacks: Array<(delta: number) => void> = [];

    constructor(private context: GameContext) { }

    /**
     * Registers a subsystem or manager to be updated every frame.
     * Order of registration determines execution order.
     */
    public addSystem(system: IUpdatable): void {
        this.updateSystems.push(system);
    }

    /**
     * Registers a callback to execute at the end of the update frame,
     * useful for cleanup tasks like clearing single-frame input flags.
     */
    public onEndFrame(callback: (delta: number) => void): void {
        this.endFrameCallbacks.push(callback);
    }

    /**
     * Prepares the engine for simulation. Called by App during bootstrap.
     */
    public async initialize(): Promise<void> {
        console.log('[GameEngine] Initializing...');
    }

    /**
     * Starts the animation loop and begins updating registered systems.
     */
    public start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        console.log('[GameEngine] Engine started.');

        if (this.context.managers.render) {
            this.context.managers.render.setAnimationLoop((time, frame) => this.loop(time, frame));
        } else {
            const wrap = (time: number) => {
                this.loop(time);
                if (this.isRunning) requestAnimationFrame(wrap);
            };
            requestAnimationFrame(wrap);
        }
    }

    /**
     * Stops the engine simulation loop.
     */
    public stop(): void {
        this.isRunning = false;
    }

    private loop(currentTime: number, frame?: XRFrame): void {
        if (!this.isRunning) return;

        const delta = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;
        this.context.deltaTime = delta;

        this.update(delta, frame);
    }

    private update(delta: number, frame?: XRFrame): void {
        for (const system of this.updateSystems) {
            system.update(delta, frame);
        }

        for (const callback of this.endFrameCallbacks) {
            callback(delta);
        }
    }
}
