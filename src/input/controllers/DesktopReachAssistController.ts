import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { IHandIntentPayload } from '../../shared/contracts/IIntents';
import { isMobile } from '../../shared/utils/DeviceUtils';
import { GrabSkill } from '../../skills/GrabSkill';

type ReachPhase = 'idle' | 'extending' | 'holding' | 'retracting';
type HandId = 'left' | 'right';

/**
 * Non-VR helper that assists grab by animating hand reach
 * forward until the normal proximity grab succeeds. It does not change gameplay
 * rules: GrabSkill still decides what can be grabbed based on proximity only.
 */
export class NonVRReachAssistController {
    private readonly isMobileMode = isMobile;
    private mobilePressing = false;
    private mobileLatched = false;
    private phase: Record<HandId, ReachPhase> = { left: 'idle', right: 'idle' };
    private reach: Record<HandId, number> = { left: 0, right: 0 };
    private maxReach = 1.45;
    private extendSpeed = 5.4;
    private retractSpeed = 6.5;

    constructor(private context: AppContext) { }

    public update(
        delta: number,
        desktopGrabHeld: boolean,
        gamepadLeftGrabHeld: boolean,
        gamepadRightGrabHeld: boolean
    ): void {
        const render = this.context.runtime.render;
        if (!render || render.isXRPresenting() || this.context.isMenuOpen) {
            this.cancelAll();
            this.applyReachAll();
            return;
        }

        this.updateHand(delta, 'left', gamepadLeftGrabHeld);
        this.updateHand(delta, 'right', this.mobilePressing || this.mobileLatched || desktopGrabHeld || gamepadRightGrabHeld);
        this.applyReachAll();
    }

    public beginMobileAction(): void {
        if (!this.isMobileMode) return;

        if (this.mobileLatched || this.phase.right === 'holding') {
            this.mobileLatched = false;
            this.mobilePressing = false;
            if (this.isHolding('right')) {
                eventBus.emit(EVENTS.INTENT_GRAB_END, { hand: 'right' } as IHandIntentPayload);
            }
            this.phase.right = 'retracting';
            return;
        }

        this.mobilePressing = true;
        if (this.phase.right === 'idle' || this.phase.right === 'retracting') {
            this.phase.right = 'extending';
        }
    }

    public endMobileAction(): void {
        if (!this.isMobileMode) return;
        if (this.mobileLatched) return;
        this.mobilePressing = false;
        if (this.phase.right === 'extending' && !this.isHolding('right')) {
            this.phase.right = 'retracting';
        }
    }

    public hasMobilePrimaryAction(): boolean {
        return this.isMobileMode &&
            !this.context.runtime.render.isXRPresenting() &&
            !this.context.isMenuOpen;
    }

    public getMobilePrimaryActionLabel(): string | null {
        if (!this.hasMobilePrimaryAction()) return null;
        return (this.mobileLatched || this.phase.right === 'holding') ? 'Drop' : 'Grab';
    }

    public isActive(): boolean {
        return this.phase.left === 'extending' ||
            this.phase.left === 'holding' ||
            this.phase.right === 'extending' ||
            this.phase.right === 'holding';
    }

    private cancelAll(): void {
        this.cancelHand('left');
        this.cancelHand('right');
        this.mobilePressing = false;
        this.mobileLatched = false;
    }

    private cancelHand(hand: HandId): void {
        if (this.phase[hand] === 'holding' && this.isHolding(hand)) {
            eventBus.emit(EVENTS.INTENT_GRAB_END, { hand } as IHandIntentPayload);
        }
        this.phase[hand] = 'idle';
        this.reach[hand] = 0;
    }

    private updateHand(delta: number, hand: HandId, requested: boolean): void {
        const isHolding = this.isHolding(hand);

        if (requested) {
            if (this.phase[hand] === 'idle' || this.phase[hand] === 'retracting') {
                this.phase[hand] = isHolding ? 'holding' : 'extending';
            }
        } else if (this.phase[hand] === 'extending' || this.phase[hand] === 'holding') {
            if (isHolding) {
                eventBus.emit(EVENTS.INTENT_GRAB_END, { hand } as IHandIntentPayload);
            }
            this.phase[hand] = 'retracting';
            if (hand === 'right' && this.mobilePressing) {
                this.mobilePressing = false;
            }
        }

        if (this.phase[hand] === 'extending') {
            // Only transition into holding based on the state that existed at the
            // start of this frame. This keeps the reach animation visually aligned
            // with the actual hand pose instead of reacting to same-frame pulses.
            if (isHolding) {
                if (hand === 'right' && this.mobilePressing) {
                    this.mobileLatched = true;
                    this.mobilePressing = false;
                }
                this.phase[hand] = 'holding';
            } else {
                // Pulse the official grab intent at the hand pose from the previous
                // frame, then advance the reach for the next frame's visible pose.
                eventBus.emit(EVENTS.INTENT_GRAB_START, { hand } as IHandIntentPayload);
                this.reach[hand] = Math.min(this.maxReach, this.reach[hand] + this.extendSpeed * delta);
            }
        } else if (this.phase[hand] === 'holding') {
            if (!this.isHolding(hand)) {
                this.phase[hand] = requested ? 'extending' : 'retracting';
            }
        } else if (this.phase[hand] === 'retracting') {
            this.reach[hand] = Math.max(0, this.reach[hand] - this.retractSpeed * delta);
            if (this.reach[hand] <= 0.001) {
                this.reach[hand] = 0;
                this.phase[hand] = 'idle';
            }
        }
    }

    private applyReachAll(): void {
        this.context.runtime.tracking.setAssistedReach('left', this.reach.left > 0 ? this.reach.left : null);
        this.context.runtime.tracking.setAssistedReach('right', this.reach.right > 0 ? this.reach.right : null);
    }

    private isHolding(hand: HandId): boolean {
        const grabSkill = this.context.localPlayer?.getSkill('grab');
        if (grabSkill instanceof GrabSkill) {
            return grabSkill.isHoldingHand(hand);
        }
        return false;
    }
}
