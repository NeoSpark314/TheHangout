import { GameContext } from '../../app/AppContext';
import { INPUT_CONFIG } from '../../shared/constants/Constants';

export class GamepadManager {
    public move = { x: 0, y: 0 };
    public look = { x: 0, y: 0 };
    public buttons: Record<number, boolean> = {};
    public lastButtons: Record<number, boolean> = {};
    public navIndex = -1;
    public navCooldown = 0;
    private deadzone: number = INPUT_CONFIG.DEADZONE;

    constructor(private context: GameContext) { }

    public poll(delta: number): void {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[0];

        if (!gp) {
            this.move = { x: 0, y: 0 };
            this.look = { x: 0, y: 0 };
            return;
        }

        const applyDeadzone = (val: number) => Math.abs(val) < this.deadzone ? 0 : val;
        this.move.x = applyDeadzone(gp.axes[0] || 0);
        this.move.y = applyDeadzone(gp.axes[1] || 0);
        this.look.x = applyDeadzone(gp.axes[2] || 0);
        this.look.y = applyDeadzone(gp.axes[3] || 0);

        this.lastButtons = { ...this.buttons };
        gp.buttons.forEach((btn, i) => {
            this.buttons[i] = btn.pressed;
        });

        this.handleUINavigation(delta, gp);
    }

    private handleUINavigation(delta: number, gp: Gamepad): void {
        const ui = this.context.managers.ui;
        if (!ui || !(ui as any).overlay || (ui as any).overlay.style.display === 'none') {
            this.navIndex = -1;
            return;
        }

        const elements = ui.getNavigableElements();
        if (elements.length === 0) return;

        if (this.navIndex === -1 && Math.abs(this.move.y) > 0.5) {
            this.navIndex = 0;
            this.updateUIFocus(elements);
        }

        if (this.navCooldown > 0) {
            this.navCooldown -= delta;
            return;
        }

        let moved = false;
        if (this.move.y < -0.6) { this.navIndex--; moved = true; }
        else if (this.move.y > 0.6) { this.navIndex++; moved = true; }

        if (moved) {
            if (this.navIndex < 0) this.navIndex = elements.length - 1;
            if (this.navIndex >= elements.length) this.navIndex = 0;
            this.updateUIFocus(elements);
            this.navCooldown = 0.25;
        }

        if (this.buttons[0] && !this.lastButtons[0]) {
            const focused = elements[this.navIndex];
            if (focused) focused.click();
        }
    }

    private updateUIFocus(elements: HTMLElement[]): void {
        elements.forEach((el, i) => {
            if (i === this.navIndex) {
                el.classList.add('gamepad-focus');
                el.focus();
            } else {
                el.classList.remove('gamepad-focus');
            }
        });
    }
}
