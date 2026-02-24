import * as THREE from 'three';
import eventBus from '../core/EventBus';
import gameState from '../core/GameState';
import { EVENTS, INPUT_CONFIG } from '../utils/Constants';
import { VirtualJoystick } from '../utils/VirtualJoystick';
import { InteractionPointer } from '../interfaces/IPointer';
import { RenderManager } from '../managers/RenderManager';
import { XRSystem } from '../systems/XRSystem';

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

    // XR Input State
    public xrMove: { x: number, y: number } = { x: 0, y: 0 };
    public xrTurn: number = 0; // -1 to 1 for snap/smooth turn intent

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

        // Map mouse click to primary_action
        window.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.keyboard['primary_action'] = true;
                this.justPressed.add('primary_action');
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.keyboard['primary_action'] = false;
            }
        });
    }

    public initMobileJoysticks(): void {
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

        // Add XR movement
        v.x += this.xrMove.x;
        v.y += this.xrMove.y;

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
        this.pollXRInputs(frame);
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

    private pollXRInputs(frame?: XRFrame): void {
        this.xrMove = { x: 0, y: 0 };
        this.xrTurn = 0;

        const render = gameState.managers.render;
        if (!render || !render.isXRPresenting()) return;

        const session = render.getXRSession();
        if (!session) return;

        for (const source of session.inputSources) {
            if (source.gamepad) {
                const axes = source.gamepad.axes;
                // Standard mapping: Left stick for move, Right stick for turn
                if (source.handedness === 'left') {
                    // axes[2], axes[3] are often the sticks on many controllers
                    const dx = axes.length >= 4 ? axes[2] : axes[0];
                    const dy = axes.length >= 4 ? axes[3] : axes[1];
                    if (Math.abs(dx) > 0.1) this.xrMove.x += dx;
                    if (Math.abs(dy) > 0.1) this.xrMove.y += dy;
                } else if (source.handedness === 'right') {
                    const dx = axes.length >= 4 ? axes[2] : axes[0];
                    if (Math.abs(dx) > 0.1) this.xrTurn = dx;
                }
            }
        }
    }

    public getPointers(render: RenderManager, xr: XRSystem): InteractionPointer[] {
        const pointers: InteractionPointer[] = [];

        if (render.isXRPresenting()) {
            const session = render.getXRSession();
            if (!session) return pointers;

            for (let i = 0; i < session.inputSources.length; i++) {
                const source = session.inputSources[i];
                if (!source.handedness || (source.handedness !== 'left' && source.handedness !== 'right')) continue;

                const pose = xr.getControllerWorldPose(render, i);
                const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w));

                pointers.push({
                    id: `xr_${source.handedness}`,
                    origin: pose.position,
                    direction: { x: dir.x, y: dir.y, z: dir.z },
                    quaternion: pose.quaternion,
                    isProximity: true,
                    isSqueezing: (source.gamepad?.buttons[1]?.value || 0) > 0.5,
                    isInteracting: (source.gamepad?.buttons[0]?.value || 0) > 0.5,
                    triggerValue: source.gamepad?.buttons[0]?.value || 0,
                    hand: source.handedness
                });
            }
        } else {
            // Desktop Pointer (Center of Camera)
            const camPos = new THREE.Vector3();
            const camDir = new THREE.Vector3();
            const camQuat = new THREE.Quaternion();
            render.camera.getWorldPosition(camPos);
            render.camera.getWorldDirection(camDir);
            render.camera.getWorldQuaternion(camQuat);

            pointers.push({
                id: 'desktop_main',
                origin: { x: camPos.x, y: camPos.y, z: camPos.z },
                direction: { x: camDir.x, y: camDir.y, z: camDir.z },
                quaternion: { x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w },
                isProximity: false,
                isSqueezing: this.isKeyDown('e'),
                isInteracting: this.isKeyDown('primary_action'),
                triggerValue: this.isKeyDown('primary_action') ? 1.0 : 0.0,
                hand: 'right' // Default for logic
            });
        }

        return pointers;
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
