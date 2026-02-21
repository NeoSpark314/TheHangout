// managers/InputManager.js
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS, INPUT_CONFIG } from '../utils/Constants.js';
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

        this.gamepad = {
            move: { x: 0, y: 0 },
            look: { x: 0, y: 0 },
            buttons: {},
            lastButtons: {},
            navIndex: -1,
            navCooldown: 0
        };

        this.deadzone = INPUT_CONFIG.DEADZONE;

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

    update(delta) {
        this.pollGamepad(delta);
    }

    pollGamepad(delta) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[0]; // Primary gamepad

        if (!gp) {
            this.gamepad.move = { x: 0, y: 0 };
            this.gamepad.look = { x: 0, y: 0 };
            return;
        }

        // 1. Axes (Deadzones)
        const applyDeadzone = (val) => Math.abs(val) < this.deadzone ? 0 : val;

        this.gamepad.move.x = applyDeadzone(gp.axes[0] || 0);
        this.gamepad.move.y = applyDeadzone(gp.axes[1] || 0);
        this.gamepad.look.x = applyDeadzone(gp.axes[2] || 0);
        this.gamepad.look.y = applyDeadzone(gp.axes[3] || 0);

        // 2. Buttons
        this.gamepad.lastButtons = { ...this.gamepad.buttons };
        gp.buttons.forEach((btn, i) => {
            this.gamepad.buttons[i] = btn.pressed;
        });

        // 3. UI Navigation
        this.handleUINavigation(delta, gp);
    }

    handleUINavigation(delta, gp) {
        const ui = gameState.managers.ui;
        if (!ui || !ui.overlay || ui.overlay.style.display === 'none') {
            this.gamepad.navIndex = -1;
            return;
        }

        const elements = ui.getNavigableElements();
        if (elements.length === 0) return;

        // Auto-focus first element if none focused and moving stick
        if (this.gamepad.navIndex === -1 && (Math.abs(this.gamepad.move.y) > 0.5 || gp.axes[9] !== undefined)) {
            this.gamepad.navIndex = 0;
            this.updateUIFocus(elements);
        }

        // Navigation Cooldown
        if (this.gamepad.navCooldown > 0) {
            this.gamepad.navCooldown -= delta;
            return;
        }

        const COOLDOWN = 0.25;
        let moved = false;

        // D-Pad or Left Stick Y
        const dy = this.gamepad.move.y;
        const dx = this.gamepad.move.x;
        const dpadUp = gp.buttons[12]?.pressed;
        const dpadDown = gp.buttons[13]?.pressed;
        const dpadLeft = gp.buttons[14]?.pressed;
        const dpadRight = gp.buttons[15]?.pressed;

        if (dy < -0.6 || dpadUp || dx < -0.6 || dpadLeft) {
            this.gamepad.navIndex--;
            moved = true;
        } else if (dy > 0.6 || dpadDown || dx > 0.6 || dpadRight) {
            this.gamepad.navIndex++;
            moved = true;
        }

        if (moved) {
            if (this.gamepad.navIndex < 0) this.gamepad.navIndex = elements.length - 1;
            if (this.gamepad.navIndex >= elements.length) this.gamepad.navIndex = 0;
            this.updateUIFocus(elements);
            this.gamepad.navCooldown = COOLDOWN;
        }

        // Click (Button South / A)
        if (this.gamepad.buttons[0] && !this.gamepad.lastButtons[0]) {
            const focused = elements[this.gamepad.navIndex];
            if (focused) focused.click();
        }
    }

    updateUIFocus(elements) {
        elements.forEach((el, i) => {
            if (i === this.gamepad.navIndex) {
                el.classList.add('gamepad-focus');
                el.focus(); // Browser focus for inputs
            } else {
                el.classList.remove('gamepad-focus');
            }
        });
    }

    getMovementVector() {
        const v = { x: 0, y: 0 };

        // 1. Keyboard
        if (this.keyboard.w) v.y -= 1;
        if (this.keyboard.s) v.y += 1;
        if (this.keyboard.a) v.x -= 1;
        if (this.keyboard.d) v.x += 1;

        // 2. Gamepad
        v.x += this.gamepad.move.x;
        v.y += this.gamepad.move.y;

        // 3. Mobile Joystick (Movement)
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
        const v = { x: 0, y: 0 };

        // 1. Gamepad (Apply independent sensitivity)
        v.x += this.gamepad.look.x * INPUT_CONFIG.GAMEPAD_LOOK_SENSITIVITY;
        v.y += this.gamepad.look.y * INPUT_CONFIG.GAMEPAD_LOOK_SENSITIVITY;

        // 2. Mobile Joystick (Apply independent sensitivity)
        if (this.joysticks.look) {
            const jv = this.joysticks.look.getVector();
            v.x += jv.x * INPUT_CONFIG.MOBILE_LOOK_SENSITIVITY;
            v.y += jv.y * INPUT_CONFIG.MOBILE_LOOK_SENSITIVITY;
        }
        return v;
    }
}
