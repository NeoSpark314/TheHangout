// managers/InputManager.js
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';
import { VirtualJoystick } from '../utils/VirtualJoystick.js';

export class InputManager {
    constructor() {
        this.keyboard = {
            w: false, a: false, s: false, d: false
        };

        this.joysticks = {
            move: null,
            look: null
        };

        this.initKeyboard();
    }

    initKeyboard() {
        window.addEventListener('keydown', (e) => this.onKey(e.key.toLowerCase(), true));
        window.addEventListener('keyup', (e) => this.onKey(e.key.toLowerCase(), false));
    }

    onKey(key, isDown) {
        if (this.keyboard.hasOwnProperty(key)) {
            this.keyboard[key] = isDown;
        }
    }

    initMobileJoysticks() {
        console.log('[InputManager] Initializing Mobile Joysticks');

        // Cleanup existing if any
        const left = document.getElementById('joystick-left');
        const right = document.getElementById('joystick-right');
        if (left) left.innerHTML = '';
        if (right) right.innerHTML = '';

        this.joysticks.move = new VirtualJoystick('joystick-left');
        this.joysticks.look = new VirtualJoystick('joystick-right');
    }

    getMovementVector() {
        const v = { x: 0, y: 0 };

        // 1. Keyboard
        if (this.keyboard.w) v.y -= 1;
        if (this.keyboard.s) v.y += 1;
        if (this.keyboard.a) v.x -= 1;
        if (this.keyboard.d) v.x += 1;

        // 2. Mobile Joystick (Movement)
        if (this.joysticks.move) {
            const jv = this.joysticks.move.getVector();
            v.x += jv.x;
            v.y += jv.y;
        }

        // Clamp to circle for diagonal speed consistency
        const length = Math.sqrt(v.x * v.x + v.y * v.y);
        if (length > 1) {
            v.x /= length;
            v.y /= length;
        }

        return v;
    }

    getLookVector() {
        if (this.joysticks.look) {
            return this.joysticks.look.getVector();
        }
        return { x: 0, y: 0 };
    }
}
