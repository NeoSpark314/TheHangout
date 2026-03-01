import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IHandIntentPayload } from '../interfaces/IIntents';
import { isMobile } from '../utils/DeviceUtils';
import { IHandState } from '../interfaces/ITrackingProvider';

/**
 * Mobile-specific local adapter that projects a simple camera-based focus model
 * into the existing XR-first hand/intent system. This keeps non-XR reach logic
 * out of gameplay skills while still letting mobile reuse the same grab flow.
 */
export class MobileInteractionController {
    private readonly enabled = isMobile;
    private focusedInteractable = false;
    private actionActive = false;
    private rayOrigin = new THREE.Vector3();
    private rayDirection = new THREE.Vector3();
    private forward = new THREE.Vector3();
    private handPoint = new THREE.Vector3();
    private focusedPoint = new THREE.Vector3();
    private worldQuat = new THREE.Quaternion();
    private handDistance = 0.75;
    private rayDistance = 3.5;

    constructor(private context: GameContext) { }

    public update(): void {
        if (!this.enabled) return;

        const render = this.context.managers.render;
        const tracking = this.context.managers.tracking;
        if (!render || render.isXRPresenting() || !tracking) return;

        const trackingState = tracking.getState();
        const rightHand = trackingState.hands.right;

        if (this.context.isMenuOpen) {
            this.focusedInteractable = false;
            if (this.actionActive) {
                this.endPrimaryAction();
            }
            return;
        }

        render.camera.getWorldPosition(this.rayOrigin);
        render.camera.getWorldQuaternion(this.worldQuat);
        this.forward.set(0, 0, -1).applyQuaternion(this.worldQuat).normalize();
        this.rayDirection.copy(this.forward);

        const focusHit = this.context.managers.interaction.findInteractableHitUnderRay(
            { origin: this.rayOrigin, direction: this.rayDirection },
            this.rayDistance
        );
        this.focusedInteractable = !!focusHit;

        if (focusHit) {
            this.focusedPoint.copy(focusHit.point);
        }

        const handTarget = this.actionActive && focusHit ? this.focusedPoint : null;
        this.applyRightHandPose(rightHand, handTarget);

        if (!focusHit && this.actionActive) {
            this.endPrimaryAction();
        }
    }

    public hasPrimaryAction(): boolean {
        return this.enabled &&
            !this.context.isMenuOpen &&
            !this.context.managers.render.isXRPresenting() &&
            this.focusedInteractable;
    }

    public isFocusActive(): boolean {
        return this.hasPrimaryAction();
    }

    public getPrimaryActionLabel(): string | null {
        return this.hasPrimaryAction() ? 'Grab' : null;
    }

    public beginPrimaryAction(): void {
        if (!this.hasPrimaryAction() || this.actionActive) return;
        this.actionActive = true;
        this.update();
        eventBus.emit(EVENTS.INTENT_GRAB_START, { hand: 'right' } as IHandIntentPayload);
    }

    public endPrimaryAction(): void {
        if (!this.actionActive) return;
        this.actionActive = false;
        eventBus.emit(EVENTS.INTENT_GRAB_END, { hand: 'right' } as IHandIntentPayload);
    }

    private applyRightHandPose(handState: IHandState, targetPoint: THREE.Vector3 | null): void {
        if (targetPoint) {
            this.handPoint.copy(targetPoint);
        } else {
            this.handPoint.copy(this.forward).multiplyScalar(this.handDistance).add(this.rayOrigin);
        }

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
