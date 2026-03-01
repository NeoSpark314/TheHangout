import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IHandIntentPayload } from '../interfaces/IIntents';
import { isMobile } from '../utils/DeviceUtils';
import { IHandState } from '../interfaces/ITrackingProvider';

type HandId = 'left' | 'right';

/**
 * Local non-VR adapter that turns a center-screen reticle into XR-style hand grabs.
 * It performs the reticle focus query outside gameplay systems, moves a logical hand
 * to the grab point for the grab start, then keeps the hand in a stable carry pose.
 */
export class NonVRReticleInteractionController {
    private readonly isMobileMode = isMobile;
    private focused = false;
    private mobileRightLatched = false;
    private activeHands: Record<HandId, boolean> = { left: false, right: false };
    private justStartedHands: Record<HandId, boolean> = { left: false, right: false };
    private mousePrimaryHeld = false;
    private gamepadLeftHeld = false;
    private gamepadRightHeld = false;

    private rayOrigin = new THREE.Vector3();
    private rayDirection = new THREE.Vector3();
    private forward = new THREE.Vector3();
    private focusedPoint = new THREE.Vector3();
    private worldQuat = new THREE.Quaternion();
    private handPoint = new THREE.Vector3();
    private anchorOffset = new THREE.Vector3();

    private rayDistance = 3.5;

    constructor(private context: GameContext) { }

    public update(mousePrimaryHeld: boolean, gamepadLeftHeld: boolean, gamepadRightHeld: boolean): void {
        this.mousePrimaryHeld = mousePrimaryHeld;
        this.gamepadLeftHeld = gamepadLeftHeld;
        this.gamepadRightHeld = gamepadRightHeld;

        const render = this.context.managers.render;
        const tracking = this.context.managers.tracking;
        if (!render || render.isXRPresenting() || !tracking) {
            this.releaseAll();
            this.focused = false;
            return;
        }

        render.camera.getWorldPosition(this.rayOrigin);
        render.camera.getWorldQuaternion(this.worldQuat);
        this.forward.set(0, 0, -1).applyQuaternion(this.worldQuat).normalize();
        this.rayDirection.copy(this.forward);

        if (this.context.isMenuOpen) {
            this.focused = false;
            this.releaseAll();
            return;
        }

        const focusHit = this.context.managers.interaction.findInteractableHitUnderRay(
            { origin: this.rayOrigin, direction: this.rayDirection },
            this.rayDistance
        );
        this.focused = !!focusHit;
        if (focusHit) {
            this.focusedPoint.copy(focusHit.point);
        }

        this.reconcileHand('left', gamepadLeftHeld, focusHit ? this.focusedPoint : null);
        this.reconcileHand('right', this.mobileRightLatched || mousePrimaryHeld || gamepadRightHeld, focusHit ? this.focusedPoint : null);

        if (!focusHit && this.mobileRightLatched && !this.activeHands.right) {
            this.mobileRightLatched = false;
        }
    }

    public toggleMobilePrimaryAction(): void {
        if (!this.isMobileMode) return;

        if (this.mobileRightLatched) {
            this.mobileRightLatched = false;
            this.stopAssistHand('right');
            return;
        }

        if (!this.canStartGrab()) return;

        this.mobileRightLatched = true;
        this.startAssistHand('right', this.focusedPoint);
    }

    public hasMobilePrimaryAction(): boolean {
        if (!this.isMobileMode) return false;
        return this.mobileRightLatched || this.canStartGrab();
    }

    public getMobilePrimaryActionLabel(): string | null {
        if (!this.hasMobilePrimaryAction()) return null;
        return this.mobileRightLatched ? 'Drop' : 'Grab';
    }

    public isReticleFocused(): boolean {
        return this.focused;
    }

    private reconcileHand(hand: HandId, shouldHold: boolean, focusPoint: THREE.Vector3 | null): void {
        if (shouldHold) {
            if (!this.activeHands[hand]) {
                if (!focusPoint) return;
                this.startAssistHand(hand, focusPoint);
            }
        } else if (this.activeHands[hand]) {
            this.stopAssistHand(hand);
        }

        if (!this.activeHands[hand]) return;

        if (this.justStartedHands[hand]) {
            this.justStartedHands[hand] = false;
            return;
        }

        const handState = this.context.managers.tracking.getState().hands[hand];
        this.placeHandAtCarryAnchor(handState, hand);
    }

    private canStartGrab(): boolean {
        return !!this.context.managers.render &&
            !this.context.managers.render.isXRPresenting() &&
            !this.context.isMenuOpen &&
            this.focused;
    }

    private startAssistHand(hand: HandId, point: THREE.Vector3): void {
        const handState = this.context.managers.tracking.getState().hands[hand];
        this.placeHandAtWorldPoint(handState, point);
        this.activeHands[hand] = true;
        this.justStartedHands[hand] = true;
        eventBus.emit(EVENTS.INTENT_GRAB_START, { hand } as IHandIntentPayload);
    }

    private stopAssistHand(hand: HandId): void {
        if (!this.activeHands[hand]) return;
        this.activeHands[hand] = false;
        this.justStartedHands[hand] = false;
        eventBus.emit(EVENTS.INTENT_GRAB_END, { hand } as IHandIntentPayload);
    }

    private releaseAll(): void {
        if (this.mobileRightLatched) {
            this.mobileRightLatched = false;
        }
        this.stopAssistHand('left');
        this.stopAssistHand('right');
    }

    private placeHandAtWorldPoint(handState: IHandState, point: THREE.Vector3): void {
        this.handPoint.copy(point);
        this.applyPose(handState);
    }

    private placeHandAtCarryAnchor(handState: IHandState, hand: HandId): void {
        this.anchorOffset.set(hand === 'left' ? -0.18 : 0.18, -0.14, -0.55);
        this.anchorOffset.applyQuaternion(this.worldQuat);
        this.handPoint.copy(this.rayOrigin).add(this.anchorOffset);
        this.applyPose(handState);
    }

    private applyPose(handState: IHandState): void {
        handState.active = true;
        handState.pose.position = { x: this.handPoint.x, y: this.handPoint.y, z: this.handPoint.z };
        handState.pose.quaternion = {
            x: this.worldQuat.x,
            y: this.worldQuat.y,
            z: this.worldQuat.z,
            w: this.worldQuat.w
        };
        handState.pointerPose.position = { ...handState.pose.position };
        handState.pointerPose.quaternion = { ...handState.pose.quaternion };
    }
}
