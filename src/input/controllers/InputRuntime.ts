import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import { INPUT_CONFIG } from '../../shared/constants/Constants';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { IMoveIntentPayload, ILookIntentPayload, IHandIntentPayload, IVRSnapTurnPayload } from '../../shared/contracts/IIntents';

import { KeyboardManager } from './KeyboardController';
import { GamepadManager } from './GamepadController';
import { MobileJoystickManager } from './MobileJoystickController';
import { NonVRReachAssistController } from './DesktopReachAssistController';
import { NonVRInteractionController } from './DesktopInteractionController';
import { XRInputManager } from './XRInputController';
import { GestureUtils } from '../../shared/utils/GestureUtils';
import { GrabSkill } from '../../skills/GrabSkill';

export type DesktopInputMode = 'keyboardMouse' | 'controller';

/**
 * Aggregates user input from multiple distinct hardware sources (Keyboard, Gamepad, Mobile Joysticks, XR).
 * Provides a unified interface for querying movement semantic intentions and handling VR pointers.
 */
export class InputRuntime implements IUpdatable {
    public keyboard: KeyboardManager;
    public gamepad: GamepadManager;
    public mobileJoystick: MobileJoystickManager;
    public nonVRReachAssist: NonVRReachAssistController;
    public nonVRInteraction: NonVRInteractionController;
    public xrInput: XRInputManager;
    private desktopInputMode: DesktopInputMode = 'keyboardMouse';
    private lastDesktopInputAt: Record<DesktopInputMode, number> = {
        keyboardMouse: 0,
        controller: 0
    };
    private readonly modeSwitchGuardMs = 250;
    private controllerYawRateDegPerSec = 0;
    private controllerPitchRateDegPerSec = 0;
    private readonly controllerLookBaseDegPerSec = 0;
    private readonly controllerLookMaxDegPerSec = 220;
    private readonly controllerTurnAccel = 11;
    private readonly controllerTurnDecel = 30;
    private readonly controllerTurnBoostStart = 0.9;
    private readonly controllerTurnBoostFactor = 0.2;
    private readonly mouseLookRadiansPerPixel = 0.002;
    private readonly mobileLookMaxRadiansPerSec = 1.1;

    constructor(private context: AppContext) {
        this.keyboard = new KeyboardManager();
        this.gamepad = new GamepadManager();
        this.mobileJoystick = new MobileJoystickManager();
        this.nonVRReachAssist = new NonVRReachAssistController(context);
        this.nonVRInteraction = new NonVRInteractionController(context);
        this.xrInput = new XRInputManager(context);

        this._initMouseLook();
        this._initDesktopInputModeTracking();
    }

    private _initMouseLook(): void {
        document.addEventListener('mousemove', (e) => {
            const render = this.context.runtime.render;
            const appContainer = document.getElementById('app');
            const renderCanvas = render?.renderer?.domElement || null;
            const lockEl = document.pointerLockElement;
            const isLockedToApp = !!appContainer && lockEl === appContainer;
            const isLockedToCanvas = !!renderCanvas && lockEl === renderCanvas;
            if ((isLockedToApp || isLockedToCanvas) && render && !render.isXRPresenting()) {
                eventBus.emit(EVENTS.INTENT_LOOK, {
                    yawDeltaRad: e.movementX * this.mouseLookRadiansPerPixel,
                    pitchDeltaRad: e.movementY * this.mouseLookRadiansPerPixel
                } as ILookIntentPayload);
                if (e.movementX !== 0 || e.movementY !== 0) {
                    this.markDesktopInputActivity('keyboardMouse');
                }
            }
        });
    }

    private _initDesktopInputModeTracking(): void {
        window.addEventListener('keydown', () => {
            this.markDesktopInputActivity('keyboardMouse');
        });

        window.addEventListener('mousedown', () => {
            this.markDesktopInputActivity('keyboardMouse');
        });

        window.addEventListener('touchstart', () => {
            this.markDesktopInputActivity('keyboardMouse');
        }, { passive: true });
    }

    public initMobileJoysticks(): void {
        this.mobileJoystick.init();
    }

    public getMobilePrimaryActionLabel(): string | null {
        return this.nonVRReachAssist.getMobilePrimaryActionLabel();
    }

    public hasMobilePrimaryAction(): boolean {
        return this.nonVRReachAssist.hasMobilePrimaryAction();
    }

    public hasMobileSecondaryAction(): boolean { return this.nonVRInteraction.hasMobileSecondaryAction(); }

    public isMobileFocusActive(): boolean {
        return this.nonVRReachAssist.isActive();
    }

    public beginMobilePrimaryAction(): void {
        this.nonVRReachAssist.beginMobileAction();
    }

    public endMobilePrimaryAction(): void {
        this.nonVRReachAssist.endMobileAction();
    }

    public toggleMobileSecondaryAction(): void { this.nonVRInteraction.toggleMobileSecondaryAction(); }

    public getMobileSecondaryActionLabel(): string | null { return this.nonVRInteraction.getMobileSecondaryActionLabel(); }

    public isKeyPressed(key: string): boolean {
        return this.keyboard.isKeyPressed(key);
    }

    public isKeyDown(key: string): boolean {
        return this.keyboard.isKeyDown(key);
    }

    public clearJustPressed(): void {
        this.keyboard.clearJustPressed();
    }

    public getDesktopInputMode(): DesktopInputMode {
        return this.desktopInputMode;
    }

    public getMovementVector(): { x: number, y: number } {
        const keyboard = { x: 0, y: 0 };
        if (this.isKeyDown('w')) keyboard.y -= 1;
        if (this.isKeyDown('s')) keyboard.y += 1;
        if (this.isKeyDown('a')) keyboard.x -= 1;
        if (this.isKeyDown('d')) keyboard.x += 1;

        const keyboardLength = Math.sqrt(keyboard.x * keyboard.x + keyboard.y * keyboard.y);
        if (keyboardLength > 1) {
            keyboard.x /= keyboardLength;
            keyboard.y /= keyboardLength;
        }

        const mobile = this.mobileJoystick.getMoveVector();
        const usingController = this.desktopInputMode === 'controller';
        const usingKeyboardMouse = !usingController;

        const v = {
            x: (usingKeyboardMouse ? (keyboard.x + mobile.x) : this.gamepad.move.x) + this.xrInput.move.x,
            y: (usingKeyboardMouse ? (keyboard.y + mobile.y) : this.gamepad.move.y) + this.xrInput.move.y
        };

        const length = Math.sqrt(v.x * v.x + v.y * v.y);
        if (length > 1) {
            v.x /= length;
            v.y /= length;
        }
        return v;
    }

    public getLookVector(): { x: number, y: number } {
        const jv = this.mobileJoystick.getLookVector();
        return {
            x: jv.x * INPUT_CONFIG.MOBILE_LOOK_SENSITIVITY,
            y: jv.y * INPUT_CONFIG.MOBILE_LOOK_SENSITIVITY
        };
    }

    private _wasSnapTurnPressed = false;
    private xrInteractionLatchedHand: 'left' | 'right' | null = null;
    private previousHandStates = {
        left: { isSqueezing: false, isInteracting: false },
        right: { isSqueezing: false, isInteracting: false }
    };
    private gestureLatch = {
        left: { pinch: false, fist: false },
        right: { pinch: false, fist: false }
    };

    public update(delta: number, frame?: XRFrame): void {
        this.gamepad.poll(delta);
        if (this.gamepad.hadMeaningfulInputThisFrame) {
            this.markDesktopInputActivity('controller');
        }
        this.xrInput.poll(delta, frame);
        if (this.gamepad.wasPressed(3) || this.xrInput.wasMenuShortPressJustTriggered()) {
            eventBus.emit(EVENTS.INTENT_MENU_TOGGLE);
        }
        if (this.xrInput.wasMenuLongPressJustTriggered()) {
            eventBus.emit(EVENTS.INTENT_MENU_OPEN_RECENTER);
        }
        if (this.xrInteractionLatchedHand && !this.isXRBubbleInteractionEligible(this.xrInteractionLatchedHand)) {
            this.xrInteractionLatchedHand = null;
        }

        const runtime = this.context.runtime;
        const render = runtime.render;
        const tracking = runtime.tracking;

        const nonVRInteractHeld = (!this.context.isMenuOpen) &&
            (this.isKeyDown('secondary_action') || !!this.gamepad.buttons[0]);
        this.nonVRInteraction.update(nonVRInteractHeld);

        // 0. Desktop Hand Activation (Centralized Logic)
        if (render && !render.isXRPresenting() && tracking) {
            this.nonVRReachAssist.update(
                delta,
                this.isKeyDown('primary_action'),
                !!this.gamepad.buttons[6],
                !!this.gamepad.buttons[7]
            );
        }

        // 1. Continuous intents
        const isMenuOpen = this.context.isMenuOpen;
        const suppressWorldInput = isMenuOpen && !(render?.isXRPresenting());
        const move = suppressWorldInput ? { x: 0, y: 0 } : this.getMovementVector();
        eventBus.emit(EVENTS.INTENT_MOVE, { direction: move } as IMoveIntentPayload);

        if (suppressWorldInput) {
            this.resetControllerLookRates();
        } else if (this.desktopInputMode === 'controller') {
            const controllerLookDelta = this.getControllerLookDelta(delta);
            eventBus.emit(EVENTS.INTENT_LOOK, {
                yawDeltaRad: controllerLookDelta.x,
                pitchDeltaRad: controllerLookDelta.y
            } as ILookIntentPayload);
        } else {
            const look = this.getLookVector();
            if (look.x !== 0 || look.y !== 0) {
                this.markDesktopInputActivity('keyboardMouse');
                eventBus.emit(EVENTS.INTENT_LOOK, {
                    yawDeltaRad: look.x * this.mobileLookMaxRadiansPerSec * delta,
                    pitchDeltaRad: look.y * this.mobileLookMaxRadiansPerSec * delta
                } as ILookIntentPayload);
            }
        }

        runtime.ui?.handleControllerCursor(
            delta,
            this.gamepad.move,
            this.gamepad.wasPressed(0),
            this.gamepad.isConnected
        );
        runtime.vrUi?.handleControllerCursor(
            delta,
            this.gamepad.move,
            this.gamepad.wasPressed(0),
            this.gamepad.isConnected
        );

        // 2. VR Snap turning intent
        const xrTurn = this.xrInput.turn;
        if (Math.abs(xrTurn) > 0.5) {
            if (!this._wasSnapTurnPressed) {
                const sign = Math.sign(xrTurn);
                eventBus.emit(EVENTS.INTENT_VR_SNAP_TURN, { angle: sign * (-Math.PI / 4) } as IVRSnapTurnPayload);
                this._wasSnapTurnPressed = true;
            }
        } else {
            this._wasSnapTurnPressed = false;
        }

    }

    private markDesktopInputActivity(source: DesktopInputMode): void {
        const now = performance.now();
        this.lastDesktopInputAt[source] = now;

        if (this.desktopInputMode === source) return;

        const other: DesktopInputMode = source === 'controller' ? 'keyboardMouse' : 'controller';
        if ((now - this.lastDesktopInputAt[other]) < this.modeSwitchGuardMs) {
            return;
        }

        this.desktopInputMode = source;
    }

    private getControllerLookDelta(delta: number): { x: number; y: number } {
        const filteredLook = this.filterControllerLookInput(this.gamepad.look.x, this.gamepad.look.y);

        const yawRate = this.updateControllerAxisRate(delta, filteredLook.x, this.controllerYawRateDegPerSec);
        this.controllerYawRateDegPerSec = yawRate.nextRateDegPerSec;

        const pitchRate = this.updateControllerAxisRate(delta, filteredLook.y, this.controllerPitchRateDegPerSec);
        this.controllerPitchRateDegPerSec = pitchRate.nextRateDegPerSec;

        const yawRadiansThisFrame = THREE.MathUtils.degToRad(this.controllerYawRateDegPerSec) * delta;
        const pitchRadiansThisFrame = THREE.MathUtils.degToRad(this.controllerPitchRateDegPerSec) * delta;

        return {
            x: yawRadiansThisFrame,
            y: pitchRadiansThisFrame
        };
    }

    private updateControllerAxisRate(
        delta: number,
        input: number,
        currentRateDegPerSec: number
    ): { nextRateDegPerSec: number } {
        const absInput = Math.min(1, Math.abs(input));
        if (absInput <= 0.0001) {
            return {
                nextRateDegPerSec: THREE.MathUtils.damp(currentRateDegPerSec, 0, this.controllerTurnDecel, delta)
            };
        }

        const curved = absInput * absInput;
        const baseTarget = this.controllerLookBaseDegPerSec + (this.controllerLookMaxDegPerSec - this.controllerLookBaseDegPerSec) * curved;
        const boostT = Math.max(0, (absInput - this.controllerTurnBoostStart) / (1 - this.controllerTurnBoostStart));
        const boostedTarget = baseTarget * (1 + boostT * this.controllerTurnBoostFactor);
        const signedTarget = Math.sign(input) * boostedTarget;

        return {
            nextRateDegPerSec: THREE.MathUtils.damp(
                currentRateDegPerSec,
                signedTarget,
                this.controllerTurnAccel,
                delta
            )
        };
    }

    private resetControllerLookRates(): void {
        this.controllerYawRateDegPerSec = 0;
        this.controllerPitchRateDegPerSec = 0;
    }

    private filterControllerLookInput(x: number, y: number): { x: number; y: number } {
        const absX = Math.abs(x);
        const absY = Math.abs(y);

        // Suppress incidental cross-axis bleed so right-stick horizontal turns stay horizontal.
        if (absX > 0.2 && absY < absX * 0.4) {
            return { x, y: 0 };
        }
        if (absY > 0.2 && absX < absY * 0.4) {
            return { x: 0, y };
        }

        return { x, y };
    }

    public processInteractions(): void {
        const render = this.context.runtime.render;

        const currentStates = {
            left: { isSqueezing: false, isInteracting: false, triggerValue: 0 },
            right: { isSqueezing: false, isInteracting: false, triggerValue: 0 }
        };

        if (render && render.isXRPresenting()) {
            const session = render.getXRSession();
            if (session) {
                const tracking = this.context.runtime.tracking;
                const trackingState = tracking.getState();

                for (let i = 0; i < session.inputSources.length; i++) {
                    const source = session.inputSources[i];
                    if (source.handedness !== 'left' && source.handedness !== 'right') continue;

                    // Use the freshest tracked hand data from the provider directly.
                    const handState = trackingState.hands[source.handedness];
                    const state = this._getInteractionState(source, handState);
                    currentStates[source.handedness] = state;
                }
            }

            if (this.xrInteractionLatchedHand) {
                currentStates[this.xrInteractionLatchedHand].isInteracting = true;
                currentStates[this.xrInteractionLatchedHand].triggerValue = 1.0;
            }
        } else {
            // Desktop/Mobile interactions
            const tracking = this.context.runtime.tracking;
            const trackingState = tracking.getState();
            const leftActive = trackingState.hands.left.active;
            const rightActive = trackingState.hands.right.active;
            // Non-VR desktop grabbing is owned by reach assist; avoid double-firing.
            const isGrabPressed = false;
            const isInteractPressed = this.nonVRInteraction.isInteractionHeld();

            if (leftActive) {
                currentStates.left.isSqueezing = isGrabPressed;
                currentStates.left.isInteracting = isInteractPressed;
                currentStates.left.triggerValue = isInteractPressed ? 1.0 : 0.0;
            }

            if (rightActive || (!leftActive && !rightActive)) {
                // Default to right hand if both are inactive or right is active
                currentStates.right.isSqueezing = isGrabPressed;
                currentStates.right.isInteracting = isInteractPressed;
                currentStates.right.triggerValue = isInteractPressed ? 1.0 : 0.0;
            }
        }

        // Fire edge intent events based on transitions
        for (const hand of ['left', 'right'] as const) {
            const curr = currentStates[hand];
            const prev = this.previousHandStates[hand];

            if (curr.isSqueezing && !prev.isSqueezing) {
                eventBus.emit(EVENTS.INTENT_GRAB_START, { hand } as IHandIntentPayload);
            } else if (!curr.isSqueezing && prev.isSqueezing) {
                eventBus.emit(EVENTS.INTENT_GRAB_END, { hand } as IHandIntentPayload);
            }

            if (curr.isInteracting && !prev.isInteracting) {
                eventBus.emit(EVENTS.INTENT_INTERACT_START, { hand, value: curr.triggerValue } as IHandIntentPayload);
            } else if (!curr.isInteracting && prev.isInteracting) {
                eventBus.emit(EVENTS.INTENT_INTERACT_END, { hand } as IHandIntentPayload);
            }

            this.previousHandStates[hand].isSqueezing = curr.isSqueezing;
            this.previousHandStates[hand].isInteracting = curr.isInteracting;
        }
    }

    public toggleXRBubbleInteraction(hand: 'left' | 'right'): void {
        if (!this.isXRBubbleInteractionEligible(hand)) {
            return;
        }

        this.xrInteractionLatchedHand = this.xrInteractionLatchedHand === hand ? null : hand;
    }

    public isXRBubbleInteractionLatched(hand: 'left' | 'right'): boolean {
        return this.xrInteractionLatchedHand === hand;
    }

    private isXRBubbleInteractionEligible(hand: 'left' | 'right'): boolean {
        const render = this.context.runtime.render;
        if (!render || !render.isXRPresenting()) {
            return false;
        }

        const grabSkill = this.context.localPlayer?.getSkill('grab');
        return grabSkill instanceof GrabSkill && grabSkill.getSingleInteractableHoldingHand() === hand;
    }

    /**
     * Unified logic to determine interaction intent from an XR input source.
     * Maps physical buttons (Controllers) or skeletal gestures (Hands) to intents.
     */
    private _getInteractionState(source: XRInputSource, handState?: any): { isSqueezing: boolean, isInteracting: boolean, triggerValue: number } {
        // 1. Check for skeletal hand tracking first
        if (source.hand && handState && (source.handedness === 'left' || source.handedness === 'right')) {
            const hand = source.handedness;
            const latch = this.gestureLatch[hand];
            const g = INPUT_CONFIG.GESTURE;

            const pinchDist = GestureUtils.getPinchDistance(handState);
            latch.pinch = GestureUtils.updateDistanceLatch(latch.pinch, pinchDist, {
                on: g.PINCH_ON_DISTANCE,
                off: g.PINCH_OFF_DISTANCE
            });

            const curlCount = GestureUtils.getFistCurlCount(handState, g.FIST_CURL_THRESHOLD);
            latch.fist = GestureUtils.updateCountLatch(
                latch.fist,
                curlCount,
                g.FIST_ON_CURL_COUNT,
                g.FIST_OFF_CURL_COUNT
            );

            return {
                isSqueezing: latch.fist,
                isInteracting: this.xrInput.isHandLocomotionActive(hand) ? false : latch.pinch,
                triggerValue: this.xrInput.isHandLocomotionActive(hand) ? 0.0 : (latch.pinch ? 1.0 : 0.0)
            };
        }

        if (source.handedness === 'left' || source.handedness === 'right') {
            this.gestureLatch[source.handedness].pinch = false;
            this.gestureLatch[source.handedness].fist = false;
        }

        // 2. Fallback to physical controller buttons
        const triggerValue = source.gamepad?.buttons[0]?.value || 0;
        const isInteracting = triggerValue > 0.5;
        const isSqueezing = (source.gamepad?.buttons[1]?.value || 0) > 0.5;

        return {
            isSqueezing,
            isInteracting,
            triggerValue
        };
    }
}
