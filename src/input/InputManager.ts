import eventBus from '../core/EventBus';
import gameState from '../core/GameState';
import { EVENTS, INPUT_CONFIG } from '../utils/Constants';
import { Vector3, Quaternion } from '../interfaces/IMath';
import { VirtualJoystick } from '../utils/VirtualJoystick';

export enum ActionIntent {
    Grab = 'Intent_Grab',
    Interact = 'Intent_Interact',
    Move = 'Intent_Move',
    Primary = 'Intent_Primary'
}

export class InputManager {
    private keyboard: Record<string, boolean> = {};
    private justPressed: Set<string> = new Set();
    private deadzone: number = INPUT_CONFIG.DEADZONE;

    public joysticks: {
        move: VirtualJoystick | null,
        look: VirtualJoystick | null
    } = { move: null, look: null };

    public gamepad = {
        move: { x: 0, y: 0 },
        look: { x: 0, y: 0 },
        buttons: {} as Record<number, boolean>,
        lastButtons: {} as Record<number, boolean>,
        navIndex: -1,
        navCooldown: 0
    };

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

    public initMobileJoysticks(): void {
        console.log('[InputManager] Initializing Mobile Joysticks');
        const left = document.getElementById('joystick-left');
        const right = document.getElementById('joystick-right');
        if (left) left.innerHTML = '';
        if (right) right.innerHTML = '';

        this.joysticks.move = new VirtualJoystick('joystick-left');
        this.joysticks.look = new VirtualJoystick('joystick-right');
    }

    public isKeyPressed(key: string): boolean {
        return this.justPressed.has(key);
    }

    public isKeyDown(key: string): boolean {
        return !!this.keyboard[key];
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

        v.x += this.gamepad.move.x;
        v.y += this.gamepad.move.y;

        if (this.joysticks.move) {
            const jv = this.joysticks.move.getVector();
            v.x += jv.x;
            v.y += jv.y;
        }

        const length = Math.sqrt(v.x * v.x + v.y * v.y);
        if (length > 1) {
            v.x /= length;
            v.y /= length;
        }
        return v;
    }

    public getLookVector(): { x: number, y: number } {
        const v = { x: 0, y: 0 };
        v.x += this.gamepad.look.x * INPUT_CONFIG.GAMEPAD_LOOK_SENSITIVITY;
        v.y += this.gamepad.look.y * INPUT_CONFIG.GAMEPAD_LOOK_SENSITIVITY;

        if (this.joysticks.look) {
            const jv = this.joysticks.look.getVector();
            v.x += jv.x * INPUT_CONFIG.MOBILE_LOOK_SENSITIVITY;
            v.y += jv.y * INPUT_CONFIG.MOBILE_LOOK_SENSITIVITY;
        }
        return v;
    }

    public update(delta: number, frame?: XRFrame): void {
        this.pollGamepad(delta);
    }

    private pollGamepad(delta: number): void {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[0];

        if (!gp) {
            this.gamepad.move = { x: 0, y: 0 };
            this.gamepad.look = { x: 0, y: 0 };
            return;
        }

        const applyDeadzone = (val: number) => Math.abs(val) < this.deadzone ? 0 : val;
        this.gamepad.move.x = applyDeadzone(gp.axes[0] || 0);
        this.gamepad.move.y = applyDeadzone(gp.axes[1] || 0);
        this.gamepad.look.x = applyDeadzone(gp.axes[2] || 0);
        this.gamepad.look.y = applyDeadzone(gp.axes[3] || 0);

        this.gamepad.lastButtons = { ...this.gamepad.buttons };
        gp.buttons.forEach((btn, i) => {
            this.gamepad.buttons[i] = btn.pressed;
        });

        this.handleUINavigation(delta, gp);
    }

    private handleUINavigation(delta: number, gp: Gamepad): void {
        const ui = gameState.managers.ui;
        if (!ui || !(ui as any).overlay || (ui as any).overlay.style.display === 'none') {
            this.gamepad.navIndex = -1;
            return;
        }

        const elements = ui.getNavigableElements();
        if (elements.length === 0) return;

        if (this.gamepad.navIndex === -1 && Math.abs(this.gamepad.move.y) > 0.5) {
            this.gamepad.navIndex = 0;
            this.updateUIFocus(elements);
        }

        if (this.gamepad.navCooldown > 0) {
            this.gamepad.navCooldown -= delta;
            return;
        }

        let moved = false;
        if (this.gamepad.move.y < -0.6) { this.gamepad.navIndex--; moved = true; }
        else if (this.gamepad.move.y > 0.6) { this.gamepad.navIndex++; moved = true; }

        if (moved) {
            if (this.gamepad.navIndex < 0) this.gamepad.navIndex = elements.length - 1;
            if (this.gamepad.navIndex >= elements.length) this.gamepad.navIndex = 0;
            this.updateUIFocus(elements);
            this.gamepad.navCooldown = 0.25;
        }

        if (this.gamepad.buttons[0] && !this.gamepad.lastButtons[0]) {
            const focused = elements[this.gamepad.navIndex];
            if (focused) focused.click();
        }
    }

    private updateUIFocus(elements: HTMLElement[]): void {
        elements.forEach((el, i) => {
            if (i === this.gamepad.navIndex) {
                el.classList.add('gamepad-focus');
                el.focus();
            } else {
                el.classList.remove('gamepad-focus');
            }
        });
    }
}
