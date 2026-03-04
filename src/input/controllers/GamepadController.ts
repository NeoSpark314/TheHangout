import { INPUT_CONFIG } from '../../shared/constants/Constants';

export class GamepadManager {
    public move = { x: 0, y: 0 };
    public look = { x: 0, y: 0 };
    public buttons: Record<number, boolean> = {};
    public lastButtons: Record<number, boolean> = {};
    public isConnected = false;
    private deadzone: number = INPUT_CONFIG.DEADZONE;

    constructor() { }

    public poll(_delta: number): void {
        const gp = this.getActiveGamepad();
        this.isConnected = !!gp;

        if (!gp) {
            this.move = { x: 0, y: 0 };
            this.look = { x: 0, y: 0 };
            this.lastButtons = { ...this.buttons };
            this.buttons = {};
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
    }

    private getActiveGamepad(): Gamepad | null {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const candidate of gamepads) {
            if (candidate && candidate.connected) {
                return candidate;
            }
        }
        return null;
    }

    public wasPressed(buttonIndex: number): boolean {
        return !!this.buttons[buttonIndex] && !this.lastButtons[buttonIndex];
    }
}
