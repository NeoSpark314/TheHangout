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
    private _wheelDelta = 0;

    constructor(private context: AppContext) {
        this.keyboard = new KeyboardManager();
        this.gamepad = new GamepadManager();
        this.mobileJoystick = new MobileJoystickManager();
        this.nonVRReachAssist = new NonVRReachAssistController(context);
        this.nonVRInteraction = new NonVRInteractionController(context);
        this.xrInput = new XRInputManager(context);

        this._initMouseLook();
        this._initWheel();
    }

    private _initWheel(): void {
        window.addEventListener('wheel', (e) => {
            const render = this.context.runtime.render;
            if (render && !render.isXRPresenting()) {
                // We don't preventDefault() here to allow browser zooming/scrolling if needed,
                // but we capture the delta for reach adjustment.
                this._wheelDelta += -e.deltaY * 0.001;
            }
        }, { passive: true });
    }

    private _initMouseLook(): void {
        document.addEventListener('mousemove', (e) => {
            const render = this.context.runtime.render;
            const canvas = document.getElementById('app');
            if (document.pointerLockElement === canvas && render && !render.isXRPresenting()) {
                // Divide by 15 to normalize discrete mouse pixel deltas to the continuous magnitude 
                // used by joysticks and gamepads downstream in the Skills logic.
                eventBus.emit(EVENTS.INTENT_LOOK, {
                    delta: { x: e.movementX / 15, y: e.movementY / 15 }
                } as ILookIntentPayload);
            }
        });
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

        const v = {
            x: keyboard.x + mobile.x + this.gamepad.move.x + this.xrInput.move.x,
            y: keyboard.y + mobile.y + this.gamepad.move.y + this.xrInput.move.y
        };

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

        const jv = this.mobileJoystick.getLookVector();
        v.x += jv.x * INPUT_CONFIG.MOBILE_LOOK_SENSITIVITY;
        v.y += jv.y * INPUT_CONFIG.MOBILE_LOOK_SENSITIVITY;
        return v;
    }

    private _wasSnapTurnPressed = false;
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
        if (this.gamepad.wasPressed(3)) {
            eventBus.emit(EVENTS.INTENT_MENU_TOGGLE);
        }
        this.xrInput.poll(frame);

        const runtime = this.context.runtime;
        const render = runtime.render;
        const tracking = runtime.tracking;

        const nonVRInteractHeld = (!this.context.isMenuOpen) &&
            (this.isKeyDown('secondary_action') || !!this.gamepad.buttons[0]);
        this.nonVRInteraction.update(nonVRInteractHeld);

        // 0. Desktop Hand Activation (Centralized Logic)
        if (render && !render.isXRPresenting() && tracking) {
            tracking.setHandActive('left', this.isKeyDown('q'));
            tracking.setHandActive('right', this.isKeyDown('e'));
            const manualModeActive = this.isKeyDown('q') || this.isKeyDown('e');

            if (this._wheelDelta !== 0) {
                tracking.adjustReach(this._wheelDelta);
                this._wheelDelta = 0;
            }

            this.nonVRReachAssist.update(
                delta,
                manualModeActive,
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

        const look = suppressWorldInput ? { x: 0, y: 0 } : this.getLookVector();
        if (look.x !== 0 || look.y !== 0) {
            eventBus.emit(EVENTS.INTENT_LOOK, { delta: look } as ILookIntentPayload);
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
        } else {
            // Desktop/Mobile interactions
            const tracking = this.context.runtime.tracking;
            const trackingState = tracking.getState();
            const leftActive = trackingState.hands.left.active;
            const rightActive = trackingState.hands.right.active;
            const usingManualHandGrab = this.isKeyDown('q') || this.isKeyDown('e');

            // Preserve the explicit desktop hand-extension workflow. Reach assist
            // owns left-click grabbing only when the player is not manually using Q/E.
            const isGrabPressed = this.isKeyDown('primary_action') && usingManualHandGrab;
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
