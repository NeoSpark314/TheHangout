import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { INPUT_CONFIG } from '../utils/Constants';
import { InteractionPointer } from '../interfaces/IPointer';
import { IUpdatable } from '../interfaces/IUpdatable';
import { RenderManager } from '../managers/RenderManager';
import { XRSystem } from '../systems/XRSystem';

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

    public update(delta: number, frame?: XRFrame): void {
        this.gamepad.poll(delta);
        this.xrInput.poll(frame);
    }

    // Pass-through accessor for xrTurn so entities can query the exact intent
    public get xrTurn(): number {
        return this.xrInput.turn;
    }

    public getPointers(render: RenderManager, xr: XRSystem): InteractionPointer[] {
        const pointers: InteractionPointer[] = [];

        if (render.isXRPresenting()) {
            const session = render.getXRSession();
            if (!session) return pointers;

            for (let i = 0; i < session.inputSources.length; i++) {
                const source = session.inputSources[i];
                if (!source.handedness || (source.handedness !== 'left' && source.handedness !== 'right')) continue;

                const pose = xr.getControllerWorldPose(render, i);
                const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w));

                pointers.push({
                    id: `xr_${source.handedness} `,
                    origin: pose.position,
                    direction: { x: dir.x, y: dir.y, z: dir.z },
                    quaternion: pose.quaternion,
                    isProximity: true,
                    isSqueezing: (source.gamepad?.buttons[1]?.value || 0) > 0.5,
                    isInteracting: (source.gamepad?.buttons[0]?.value || 0) > 0.5,
                    triggerValue: source.gamepad?.buttons[0]?.value || 0,
                    hand: source.handedness
                });
            }
        } else {
            const camPos = new THREE.Vector3();
            const camDir = new THREE.Vector3();
            const camQuat = new THREE.Quaternion();
            render.camera.getWorldPosition(camPos);
            render.camera.getWorldDirection(camDir);
            render.camera.getWorldQuaternion(camQuat);

            pointers.push({
                id: 'desktop_main',
                origin: { x: camPos.x, y: camPos.y, z: camPos.z },
                direction: { x: camDir.x, y: camDir.y, z: camDir.z },
                quaternion: { x: camQuat.x, y: camQuat.y, z: camQuat.z, w: camQuat.w },
                isProximity: false,
                isSqueezing: this.isKeyDown('e'),
                isInteracting: this.isKeyDown('primary_action'),
                triggerValue: this.isKeyDown('primary_action') ? 1.0 : 0.0,
                hand: 'right'
            });
        }

        return pointers;
    }
}
