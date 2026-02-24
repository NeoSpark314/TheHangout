import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS, INPUT_CONFIG } from '../utils/Constants.js';
import { Vector3, Quaternion } from '../interfaces/IMath';

export enum ActionIntent {
    Grab = 'Intent_Grab',
    Interact = 'Intent_Interact',
    Move = 'Intent_Move',
    Primary = 'Intent_Primary'
}

export interface InputState {
    movement: { x: number, y: number };
    look: { x: number, y: number };
    actions: Map<ActionIntent, boolean>;
    xrHands: {
        left: { active: boolean, position: Vector3, quaternion: Quaternion };
        right: { active: boolean, position: Vector3, quaternion: Quaternion };
    };
}

export class InputManager {
    private keyboard: Record<string, boolean> = {};
    private justPressed: Set<string> = new Set();
    private deadzone: number = INPUT_CONFIG.DEADZONE;

    constructor() {
        this.initKeyboard();
    }

    private initKeyboard(): void {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (!this.keyboard[key]) this.justPressed.add(key);
            this.keyboard[key] = true;
        });
        window.addEventListener('keyup', (e) => {
            this.keyboard[e.key.toLowerCase()] = false;
        });
    }

    public isKeyPressed(key: string): boolean {
        return this.justPressed.has(key);
    }

    public clearJustPressed(): void {
        this.justPressed.clear();
    }

    public getMovementVector(): { x: number, y: number } {
        const v = { x: 0, y: 0 };
        if (this.keyboard['w']) v.y -= 1;
        if (this.keyboard['s']) v.y += 1;
        if (this.keyboard['a']) v.x -= 1;
        if (this.keyboard['d']) v.x += 1;

        // Add gamepad support here later...

        const length = Math.sqrt(v.x * v.x + v.y * v.y);
        if (length > 1) {
            v.x /= length;
            v.y /= length;
        }
        return v;
    }

    public update(delta: number): void {
        // Poll gamepads, update XR session tracking etc.
    }
}
