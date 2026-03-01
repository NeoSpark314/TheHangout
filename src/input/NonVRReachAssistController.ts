import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IHandIntentPayload } from '../interfaces/IIntents';
import { isMobile } from '../utils/DeviceUtils';
import { GrabSkill } from '../skills/GrabSkill';

type ReachPhase = 'idle' | 'extending' | 'holding' | 'retracting';

/**
 * Non-VR helper that assists the default right-hand grab by animating hand reach
 * forward until the normal proximity grab succeeds. It does not change gameplay
 * rules: GrabSkill still decides what can be grabbed based on proximity only.
 */
export class NonVRReachAssistController {
    private readonly isMobileMode = isMobile;
    private phase: ReachPhase = 'idle';
    private mobilePressing = false;
    private mobileLatched = false;
    private reach = 0;
    private maxReach = 1.45;
    private extendSpeed = 5.4;
    private retractSpeed = 6.5;

    constructor(private context: GameContext) { }

    public update(delta: number, manualModeActive: boolean, desktopGrabHeld: boolean, gamepadGrabHeld: boolean): void {
        const render = this.context.managers.render;
        if (!render || render.isXRPresenting() || this.context.isMenuOpen || manualModeActive) {
            this.cancelAll();
            this.applyReach();
            return;
        }

        const requested = this.mobilePressing || this.mobileLatched || desktopGrabHeld || gamepadGrabHeld;
        const isHolding = this.isHolding();

        if (requested) {
            if (this.phase === 'idle' || this.phase === 'retracting') {
                this.phase = isHolding ? 'holding' : 'extending';
            }
        } else if (this.phase === 'extending' || this.phase === 'holding') {
            if (isHolding) {
                eventBus.emit(EVENTS.INTENT_GRAB_END, { hand: 'right' } as IHandIntentPayload);
            }
            this.phase = 'retracting';
            if (this.mobilePressing) {
                this.mobilePressing = false;
            }
        }

        if (this.phase === 'extending') {
            this.reach = Math.min(this.maxReach, this.reach + this.extendSpeed * delta);
            if (!isHolding) {
                // Pulse the official grab intent while sweeping outward. GrabSkill remains
                // the single owner of whether proximity is sufficient to actually grab.
                eventBus.emit(EVENTS.INTENT_GRAB_START, { hand: 'right' } as IHandIntentPayload);
            }
            if (this.isHolding()) {
                if (this.mobilePressing) {
                    this.mobileLatched = true;
                    this.mobilePressing = false;
                }
                this.phase = 'holding';
            }
        } else if (this.phase === 'holding') {
            if (!this.isHolding()) {
                this.phase = requested ? 'extending' : 'retracting';
            }
        } else if (this.phase === 'retracting') {
            this.reach = Math.max(0, this.reach - this.retractSpeed * delta);
            if (this.reach <= 0.001) {
                this.reach = 0;
                this.phase = 'idle';
            }
        }

        this.applyReach();
    }

    public beginMobileAction(): void {
        if (!this.isMobileMode) return;

        if (this.mobileLatched || this.phase === 'holding') {
            this.mobileLatched = false;
            this.mobilePressing = false;
            if (this.isHolding()) {
                eventBus.emit(EVENTS.INTENT_GRAB_END, { hand: 'right' } as IHandIntentPayload);
            }
            this.phase = 'retracting';
            return;
        }

        this.mobilePressing = true;
        if (this.phase === 'idle' || this.phase === 'retracting') {
            this.phase = 'extending';
        }
    }

    public endMobileAction(): void {
        if (!this.isMobileMode) return;
        if (this.mobileLatched) return;
        this.mobilePressing = false;
        if (this.phase === 'extending' && !this.isHolding()) {
            this.phase = 'retracting';
        }
    }

    public hasMobilePrimaryAction(): boolean {
        return this.isMobileMode &&
            !this.context.managers.render.isXRPresenting() &&
            !this.context.isMenuOpen;
    }

    public getMobilePrimaryActionLabel(): string | null {
        if (!this.hasMobilePrimaryAction()) return null;
        return (this.mobileLatched || this.phase === 'holding') ? 'Drop' : 'Grab';
    }

    public isActive(): boolean {
        return this.phase === 'extending' || this.phase === 'holding';
    }

    private cancelAll(): void {
        if (this.phase === 'holding' && this.isHolding()) {
            eventBus.emit(EVENTS.INTENT_GRAB_END, { hand: 'right' } as IHandIntentPayload);
        }
        this.mobilePressing = false;
        this.mobileLatched = false;
        this.phase = 'idle';
        this.reach = 0;
    }

    private applyReach(): void {
        this.context.managers.tracking.setAssistedReach('right', this.reach > 0 ? this.reach : null);
    }

    private isHolding(): boolean {
        const grabSkill = this.context.localPlayer?.getSkill('grab');
        if (grabSkill instanceof GrabSkill) {
            return grabSkill.isHoldingHand('right');
        }
        return false;
    }
}
