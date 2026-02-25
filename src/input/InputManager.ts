import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { INPUT_CONFIG } from '../utils/Constants';
import { IInteractionPointer } from '../interfaces/IPointer';
import { IUpdatable } from '../interfaces/IUpdatable';
import { RenderManager } from '../managers/RenderManager';
import { XRSystem } from '../systems/XRSystem';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IMoveIntentPayload, ILookIntentPayload, IHandIntentPayload, IXRHandTrackedPayload, IXRHeadTrackedPayload, IVRSnapTurnPayload } from '../interfaces/IIntents';

import { KeyboardManager } from './KeyboardManager';
import { GamepadManager } from './GamepadManager';
import { MobileJoystickManager } from './MobileJoystickManager';
import { XRInputManager } from './XRInputManager';

/**
 * Aggregates user input from multiple distinct hardware sources (Keyboard, Gamepad, Mobile Joysticks, XR).
 * Provides a unified interface for querying movement semantic intentions and handling VR pointers.
 */
export class InputManager implements IUpdatable {
    public keyboard: KeyboardManager;
    public gamepad: GamepadManager;
    public mobileJoystick: MobileJoystickManager;
    public xrInput: XRInputManager;

    constructor(private context: GameContext) {
        this.keyboard = new KeyboardManager();
        this.gamepad = new GamepadManager(context);
        this.mobileJoystick = new MobileJoystickManager();
        this.xrInput = new XRInputManager(context);

        this._initMouseLook();
    }

    private _initMouseLook(): void {
        document.addEventListener('mousemove', (e) => {
            const render = this.context.managers.render;
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
        const v = { x: 0, y: 0 };
        if (this.isKeyDown('w')) v.y -= 1;
        if (this.isKeyDown('s')) v.y += 1;
        if (this.isKeyDown('a')) v.x -= 1;
        if (this.isKeyDown('d')) v.x += 1;

        v.x += this.gamepad.move.x;
        v.y += this.gamepad.move.y;

        v.x += this.xrInput.move.x;
        v.y += this.xrInput.move.y;

        const jv = this.mobileJoystick.getMoveVector();
        v.x += jv.x;
        v.y += jv.y;

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

    public update(delta: number, frame?: XRFrame): void {
        this.gamepad.poll(delta);
        this.xrInput.poll(frame);

        // 1. Continuous intents
        const move = this.getMovementVector();
        eventBus.emit(EVENTS.INTENT_MOVE, { direction: move } as IMoveIntentPayload);

        const look = this.getLookVector();
        if (look.x !== 0 || look.y !== 0) {
            eventBus.emit(EVENTS.INTENT_LOOK, { delta: look } as ILookIntentPayload);
        }

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

        // 3. Process discrete buttons and XR tracking
        this._processInteractions();
    }

    private _processInteractions(): void {
        const render = this.context.managers.render;
        const xr = this.context.managers.xr;

        const currentStates = {
            left: { isSqueezing: false, isInteracting: false, triggerValue: 0 },
            right: { isSqueezing: false, isInteracting: false, triggerValue: 0 }
        };

        if (render && render.isXRPresenting()) {
            const session = render.getXRSession();
            if (session) {
                // Emit Head Pose
                const camPos = new THREE.Vector3();
                const camQuat = new THREE.Quaternion();
                render.camera.getWorldPosition(camPos);
                render.camera.getWorldQuaternion(camQuat);
                eventBus.emit(EVENTS.INTENT_XR_HEAD_TRACKED, {
                    position: { x: camPos.x, y: camPos.y, z: camPos.z },
                    quaternion: { x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w }
                } as IXRHeadTrackedPayload);

                // Process Controllers
                for (let i = 0; i < session.inputSources.length; i++) {
                    const source = session.inputSources[i];
                    if (source.handedness !== 'left' && source.handedness !== 'right') continue;

                    const pose = xr.getControllerWorldPose(render, i);
                    const isSqueezing = (source.gamepad?.buttons[1]?.value || 0) > 0.5;
                    const triggerValue = source.gamepad?.buttons[0]?.value || 0;
                    const isInteracting = triggerValue > 0.5;

                    currentStates[source.handedness] = { isSqueezing, isInteracting, triggerValue };

                    eventBus.emit(EVENTS.INTENT_XR_HAND_TRACKED, {
                        hand: source.handedness,
                        position: pose.position,
                        quaternion: pose.quaternion,
                        isSqueezing,
                        triggerValue
                    } as IXRHandTrackedPayload);
                }
            }
        } else {
            // Desktop/Mobile interactions
            currentStates.right.isSqueezing = this.isKeyDown('e');
            currentStates.right.isInteracting = this.isKeyDown('primary_action');
            currentStates.right.triggerValue = currentStates.right.isInteracting ? 1.0 : 0.0;
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
}
