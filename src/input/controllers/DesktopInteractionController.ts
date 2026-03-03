import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { IHandIntentPayload } from '../../shared/contracts/IIntents';
import { isMobile } from '../../shared/utils/DeviceUtils';
import { GrabSkill } from '../../skills/GrabSkill';

/**
 * Local non-VR interaction adapter.
 * Owns the mobile "Use" toggle and merges it with direct non-VR interact inputs
 * (desktop right click / controller A) into one shared interaction-held signal.
 */
export class NonVRInteractionController {
    private readonly isMobileMode = isMobile;
    private mobileLatched = false;
    private directHeld = false;

    constructor(private context: AppContext) { }

    public update(directHeld: boolean): void {
        this.directHeld = directHeld;

        if (this.mobileLatched && !this.hasMobileSecondaryAction()) {
            this.mobileLatched = false;
            eventBus.emit(EVENTS.INTENT_INTERACT_END, { hand: 'right' } as IHandIntentPayload);
        }
    }

    public isInteractionHeld(): boolean {
        return this.directHeld || this.mobileLatched;
    }

    public hasMobileSecondaryAction(): boolean {
        return !this.context.isMenuOpen &&
            !!this.context.managers.render &&
            !this.context.managers.render.isXRPresenting() &&
            this.isHoldingHand('right');
    }

    public getMobileSecondaryActionLabel(): string | null {
        if (!this.hasMobileSecondaryAction()) return null;
        return this.mobileLatched ? 'Stop' : 'Use';
    }

    public toggleMobileSecondaryAction(): void {
        if (this.mobileLatched) {
            this.mobileLatched = false;
            eventBus.emit(EVENTS.INTENT_INTERACT_END, { hand: 'right' } as IHandIntentPayload);
            return;
        }

        if (!this.hasMobileSecondaryAction()) return;
        this.mobileLatched = true;
        eventBus.emit(EVENTS.INTENT_INTERACT_START, { hand: 'right', value: 1.0 } as IHandIntentPayload);
    }

    private isHoldingHand(hand: 'left' | 'right'): boolean {
        const skill = this.context.localPlayer?.getSkill('grab');
        return skill instanceof GrabSkill ? skill.isHoldingHand(hand) : false;
    }
}
