import { INPUT_CONFIG } from '../../shared/constants/Constants';

export class GamepadManager {
    public move = { x: 0, y: 0 };
    public look = { x: 0, y: 0 };
    public buttons: Record<number, boolean> = {};
    public lastButtons: Record<number, boolean> = {};
    public isConnected = false;
    private deadzone: number = INPUT_CONFIG.DEADZONE;
    private activeGamepadIndex: number | null = null;

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
        const connected = Array.from(gamepads).filter((candidate): candidate is Gamepad =>
            !!candidate &&
            candidate.connected &&
            !this.isXRGamepad(candidate)
        );
        if (connected.length === 0) {
            this.activeGamepadIndex = null;
            return null;
        }

        const likelyControllers = connected.filter((candidate) => this.isLikelyGameController(candidate));
        const pool = likelyControllers.length > 0 ? likelyControllers : connected;

        const current = this.activeGamepadIndex !== null
            ? pool.find((candidate) => candidate.index === this.activeGamepadIndex) ?? null
            : null;

        const activeCandidate = pool.find((candidate) => this.hasMeaningfulInput(candidate)) ?? null;
        if (activeCandidate) {
            this.activeGamepadIndex = activeCandidate.index;
            return activeCandidate;
        }

        if (current) {
            return current;
        }

        const fallback = [...pool].sort((a, b) => this.scoreGamepad(b) - this.scoreGamepad(a))[0] ?? null;
        this.activeGamepadIndex = fallback?.index ?? null;
        return fallback;
    }

    private isXRGamepad(gamepad: Gamepad): boolean {
        return gamepad.mapping === 'xr-standard';
    }

    private hasMeaningfulInput(gamepad: Gamepad): boolean {
        if (gamepad.axes.some((axis) => Math.abs(axis) > this.deadzone)) {
            return true;
        }

        return gamepad.buttons.some((button) => button.pressed || button.value > 0.5);
    }

    private isLikelyGameController(gamepad: Gamepad): boolean {
        const id = gamepad.id.toLowerCase();
        const hasStandardMapping = gamepad.mapping === 'standard';
        const hasExpectedLayout = gamepad.axes.length >= 2 && gamepad.buttons.length >= 4;
        const hasRichLayout = gamepad.axes.length >= 4 || gamepad.buttons.length >= 8;

        const knownController = /(controller|gamepad|xinput|xbox|playstation|dualshock|dualsense|joy-?con|8bitdo|steam|switch pro)/.test(id);
        const likelyAccessory = /(jabra|headset|headphone|audio|speaker|microphone|keyboard|mouse|consumer control|touchpad)/.test(id);

        if (likelyAccessory && !hasStandardMapping) {
            return false;
        }

        return hasStandardMapping || knownController || hasExpectedLayout || hasRichLayout;
    }

    private scoreGamepad(gamepad: Gamepad): number {
        const id = gamepad.id.toLowerCase();
        let score = 0;

        if (gamepad.mapping === 'standard') score += 100;
        if (gamepad.axes.length >= 4) score += 20;
        else if (gamepad.axes.length >= 2) score += 10;
        if (gamepad.buttons.length >= 8) score += 20;
        else if (gamepad.buttons.length >= 4) score += 10;
        if (/(controller|gamepad|xinput|xbox|playstation|dualshock|dualsense|joy-?con|8bitdo|steam|switch pro)/.test(id)) score += 30;
        if (/(jabra|headset|headphone|audio|speaker|microphone|keyboard|mouse|consumer control|touchpad)/.test(id)) score -= 100;

        return score;
    }

    public wasPressed(buttonIndex: number): boolean {
        return !!this.buttons[buttonIndex] && !this.lastButtons[buttonIndex];
    }
}
