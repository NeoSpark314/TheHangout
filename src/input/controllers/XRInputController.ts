import { AppContext } from '../../app/AppContext';
import * as THREE from 'three';
import { INPUT_CONFIG } from '../../shared/constants/Constants';
import { GestureUtils } from '../../shared/utils/GestureUtils';

export interface IHandLocomotionIndicatorState {
    visible: boolean;
    isActive: boolean;
    showMotion: boolean;
    isHovering: boolean;
    frameYaw: number;
    centerOffsetHeadLocal: { x: number; y: number; z: number };
    anchorLocal: { x: number; y: number; z: number };
    currentLocal: { x: number; y: number; z: number };
    radius: number;
}

export interface ITrackedHandUiProbe {
    tracked: boolean;
    currentLocal: { x: number; y: number; z: number };
    pinchStarted: boolean;
    pinchActive: boolean;
}

type HandId = 'left' | 'right';
type XRJointPoseCapableFrame = XRFrame & {
    getJointPose(joint: XRJointSpace, baseSpace: XRSpace): XRJointPose | null;
};

export class XRInputController {
    public move: { x: number, y: number } = { x: 0, y: 0 };
    public turn: number = 0;
    private menuPressed = false;
    private menuShortPressJustTriggered = false;
    private menuLongPressJustTriggered = false;
    private menuPressDurationSec = 0;
    private menuLongPressTriggeredForCurrentHold = false;
    private readonly menuLongPressThresholdSec = 0.65;
    private handPinchLatched: Record<HandId, boolean> = { left: false, right: false };
    private handPinchStarted: Record<HandId, boolean> = { left: false, right: false };
    private handTracked: Record<HandId, boolean> = { left: false, right: false };
    private handHovering: Record<HandId, boolean> = { left: false, right: false };
    private handCurrentLocal: Record<HandId, THREE.Vector3> = {
        left: new THREE.Vector3(),
        right: new THREE.Vector3()
    };
    private activeMoveHand: HandId | null = null;
    private activeMoveAnchor: THREE.Vector3 | null = null;
    private activeMoveCurrentLocal = new THREE.Vector3();
    private activeMoveYaw = 0;
    private readonly handActivationCenter = new THREE.Vector3(0, -0.28, -0.18);
    private readonly handActivationRadius = 0.065;
    private readonly _tempVec = new THREE.Vector3();
    private readonly _tempQuat = new THREE.Quaternion();
    private readonly _tempYawQuat = new THREE.Quaternion();
    private readonly _tempInvYawQuat = new THREE.Quaternion();
    private readonly _tempEuler = new THREE.Euler();
    private readonly _worldDelta = new THREE.Vector3();
    private readonly _localDelta = new THREE.Vector3();
    private readonly handMoveDeadzone = 0.02;
    private readonly handMoveMaxDistance = 0.14;

    constructor(private context: AppContext) { }

    public poll(delta: number, frame?: XRFrame): void {
        this.move = { x: 0, y: 0 };
        this.turn = 0;
        this.menuShortPressJustTriggered = false;
        this.menuLongPressJustTriggered = false;

        const render = this.context.runtime.render;
        if (!render || !render.isXRPresenting()) {
            this.menuPressed = false;
            this.resetAllHandMovement();
            return;
        }

        const session = render.getXRSession();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !referenceSpace) {
            this.menuPressed = false;
            this.resetAllHandMovement();
            return;
        }

        this.handTracked.left = false;
        this.handTracked.right = false;
        this.handHovering.left = false;
        this.handHovering.right = false;
        this.handPinchStarted.left = false;
        this.handPinchStarted.right = false;
        let sawMenuPressed = false;

        for (const source of session.inputSources) {
            if ((source.handedness === 'left' || source.handedness === 'right') && source.hand) {
                this.pollHandMovement(source.handedness, source, frame, referenceSpace);
            }

            if (source.gamepad) {
                if (this.isMenuButtonPressed(source)) {
                    sawMenuPressed = true;
                }
                const axes = source.gamepad.axes;
                // Standard mapping: Left stick for move, Right stick for turn
                if (source.handedness === 'left') {
                    // axes[2], axes[3] are often the sticks on many controllers
                    const dx = axes.length >= 4 ? axes[2] : axes[0];
                    const dy = axes.length >= 4 ? axes[3] : axes[1];
                    if (Math.abs(dx) > 0.1) this.move.x += dx;
                    if (Math.abs(dy) > 0.1) this.move.y += dy;
                } else if (source.handedness === 'right') {
                    const dx = axes.length >= 4 ? axes[2] : axes[0];
                    if (Math.abs(dx) > 0.1) this.turn = dx;
                }
            }
        }

        if (sawMenuPressed) {
            if (!this.menuPressed) {
                this.menuPressDurationSec = 0;
                this.menuLongPressTriggeredForCurrentHold = false;
            }

            this.menuPressDurationSec += Math.max(0, delta);
            if (!this.menuLongPressTriggeredForCurrentHold && this.menuPressDurationSec >= this.menuLongPressThresholdSec) {
                this.menuLongPressTriggeredForCurrentHold = true;
                this.menuLongPressJustTriggered = true;
            }
        } else if (this.menuPressed && !this.menuLongPressTriggeredForCurrentHold) {
            this.menuShortPressJustTriggered = true;
        }

        if (!sawMenuPressed) {
            this.menuPressDurationSec = 0;
            this.menuLongPressTriggeredForCurrentHold = false;
        }

        this.menuPressed = sawMenuPressed;

        for (const hand of ['left', 'right'] as const) {
            if (!this.handTracked[hand]) {
                this.handPinchLatched[hand] = false;
                this.handCurrentLocal[hand].set(0, 0, 0);
                if (this.activeMoveHand === hand) {
                    this.resetActiveMovement();
                }
            }
        }
    }

    private pollHandMovement(
        hand: HandId,
        source: XRInputSource,
        frame: XRFrame | undefined,
        referenceSpace: XRReferenceSpace
    ): void {
        if (!frame) {
            if (this.activeMoveHand === hand) {
                this.resetActiveMovement();
            }
            this.handPinchLatched[hand] = false;
            return;
        }

        const pinchPoint = this.getHandPinchPoint(source, frame, referenceSpace);
        if (!pinchPoint) {
            if (this.activeMoveHand === hand) {
                this.resetActiveMovement();
            }
            this.handPinchLatched[hand] = false;
            return;
        }

        const currentYaw = this.getHeadYaw();
        const currentActivationOffset = this.getActivationLocalOffset(pinchPoint, currentYaw);
        this.handTracked[hand] = true;
        this.handCurrentLocal[hand].copy(currentActivationOffset);
        this.handHovering[hand] = currentActivationOffset.lengthSq() <= (this.handActivationRadius * this.handActivationRadius);

        const pinchDistance = this.getHandPinchDistance(source, frame, referenceSpace);
        const g = INPUT_CONFIG.GESTURE;
        const nextPinchState = GestureUtils.updateDistanceLatch(this.handPinchLatched[hand], pinchDistance, {
            on: g.PINCH_ON_DISTANCE,
            off: g.PINCH_OFF_DISTANCE
        });
        const pinchStarted = !this.handPinchLatched[hand] && nextPinchState;
        this.handPinchStarted[hand] = pinchStarted;
        this.handPinchLatched[hand] = nextPinchState;

        if (this.activeMoveHand === hand) {
            if (!nextPinchState) {
                this.resetActiveMovement();
                return;
            }

            const pinnedActivationOffset = this.getActivationLocalOffset(pinchPoint, this.activeMoveYaw);
            this.activeMoveCurrentLocal.copy(pinnedActivationOffset);
            this._localDelta.copy(pinnedActivationOffset).sub(this.activeMoveAnchor!);
            this._localDelta.y = 0;
        } else {
            if (!nextPinchState) {
                return;
            }

            if (pinchStarted && this.handHovering[hand] && !this.activeMoveHand) {
                this.activeMoveHand = hand;
                this.activeMoveAnchor = currentActivationOffset.clone();
                this.activeMoveCurrentLocal.copy(currentActivationOffset);
                this.activeMoveYaw = currentYaw;
                this._localDelta.set(0, 0, 0);
            } else {
                return;
            }
        }

        const distance = Math.hypot(this._localDelta.x, this._localDelta.z);
        if (distance <= this.handMoveDeadzone) {
            return;
        }

        const scaledDistance = Math.min(1, (distance - this.handMoveDeadzone) / (this.handMoveMaxDistance - this.handMoveDeadzone));
        const norm = 1 / distance;
        this.move.x += this._localDelta.x * norm * scaledDistance;
        this.move.y += this._localDelta.z * norm * scaledDistance;
    }

    private getHandPinchPoint(
        source: XRInputSource,
        frame: XRFrame,
        referenceSpace: XRReferenceSpace
    ): THREE.Vector3 | null {
        if (!this.hasJointPoseApi(frame)) {
            return null;
        }
        const thumbTip = source.hand?.get('thumb-tip');
        const indexTip = source.hand?.get('index-finger-tip');
        if (!thumbTip || !indexTip) {
            return null;
        }

        const thumbPose = frame.getJointPose(thumbTip, referenceSpace);
        const indexPose = frame.getJointPose(indexTip, referenceSpace);
        if (!thumbPose || !indexPose) {
            return null;
        }

        const thumbWorld = this.jointPoseToWorldPosition(thumbPose);
        const indexWorld = this.jointPoseToWorldPosition(indexPose);
        return thumbWorld.add(indexWorld).multiplyScalar(0.5);
    }

    private getHandPinchDistance(
        source: XRInputSource,
        frame: XRFrame,
        referenceSpace: XRReferenceSpace
    ): number | null {
        if (!this.hasJointPoseApi(frame)) {
            return null;
        }
        const thumbTip = source.hand?.get('thumb-tip');
        const indexTip = source.hand?.get('index-finger-tip');
        if (!thumbTip || !indexTip) {
            return null;
        }

        const thumbPose = frame.getJointPose(thumbTip, referenceSpace);
        const indexPose = frame.getJointPose(indexTip, referenceSpace);
        if (!thumbPose || !indexPose) {
            return null;
        }

        return GestureUtils.getDistance3D(thumbPose.transform.position, indexPose.transform.position);
    }

    private jointPoseToWorldPosition(pose: XRJointPose): THREE.Vector3 {
        const render = this.context.runtime.render;
        this._tempVec.set(
            pose.transform.position.x,
            pose.transform.position.y,
            pose.transform.position.z
        );
        this._tempVec.applyMatrix4(render.cameraGroup.matrixWorld);
        return this._tempVec.clone();
    }

    private getHeadYaw(): number {
        const render = this.context.runtime.render;
        render.camera.getWorldQuaternion(this._tempQuat);
        this._tempEuler.setFromQuaternion(this._tempQuat, 'YXZ');
        return this._tempEuler.y;
    }

    private getYawLocalOffset(worldPoint: THREE.Vector3, yaw: number): THREE.Vector3 {
        const render = this.context.runtime.render;
        render.camera.getWorldPosition(this._tempVec);
        this._tempYawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        this._tempInvYawQuat.copy(this._tempYawQuat).invert();

        this._worldDelta.copy(worldPoint).sub(this._tempVec);
        return this._worldDelta.applyQuaternion(this._tempInvYawQuat).clone();
    }

    private getActivationLocalOffset(worldPoint: THREE.Vector3, yaw: number): THREE.Vector3 {
        return this.getYawLocalOffset(worldPoint, yaw).sub(this.handActivationCenter);
    }

    public getLeftHandLocomotionIndicatorState(): IHandLocomotionIndicatorState | null {
        const hasTrackedHand = this.handTracked.left || this.handTracked.right;
        if (!hasTrackedHand) {
            return null;
        }

        const anchor = this.activeMoveHand && this.activeMoveAnchor
            ? this.activeMoveAnchor
            : new THREE.Vector3(0, 0, 0);
        const current = this.activeMoveHand
            ? this.activeMoveCurrentLocal
            : new THREE.Vector3(0, 0, 0);

        return {
            visible: true,
            isActive: !!this.activeMoveHand,
            showMotion: !!this.activeMoveHand &&
                Math.hypot(
                    current.x - anchor.x,
                    current.z - anchor.z
                ) > this.handMoveDeadzone,
            isHovering: this.handHovering.left || this.handHovering.right,
            frameYaw: this.activeMoveHand ? this.activeMoveYaw : this.getHeadYaw(),
            centerOffsetHeadLocal: {
                x: this.handActivationCenter.x,
                y: this.handActivationCenter.y,
                z: this.handActivationCenter.z
            },
            anchorLocal: { x: anchor.x, y: anchor.y, z: anchor.z },
            currentLocal: {
                x: current.x,
                y: current.y,
                z: current.z
            },
            radius: this.handActivationRadius
        };
    }

    public isHandLocomotionActive(hand: 'left' | 'right'): boolean {
        return this.activeMoveHand === hand;
    }

    public getHandUiProbe(hand: 'left' | 'right'): ITrackedHandUiProbe {
        return {
            tracked: this.handTracked[hand],
            currentLocal: {
                x: this.handCurrentLocal[hand].x,
                y: this.handCurrentLocal[hand].y,
                z: this.handCurrentLocal[hand].z
            },
            pinchStarted: this.handPinchStarted[hand],
            pinchActive: this.handPinchLatched[hand]
        };
    }

    public wasMenuShortPressJustTriggered(): boolean {
        return this.menuShortPressJustTriggered;
    }

    public wasMenuLongPressJustTriggered(): boolean {
        return this.menuLongPressJustTriggered;
    }

    private isMenuButtonPressed(source: XRInputSource): boolean {
        const buttons = source.gamepad?.buttons;
        if (source.handedness !== 'left' || !buttons || buttons.length <= 5) {
            return false;
        }

        // xr-standard: button[5] is the upper face button (B/Y-style secondary button).
        const menuButton = buttons[5];
        return !!menuButton && (menuButton.pressed || menuButton.value > 0.5);
    }

    private hasJointPoseApi(frame: XRFrame): frame is XRJointPoseCapableFrame {
        return typeof frame.getJointPose === 'function';
    }

    private resetActiveMovement(): void {
        this.activeMoveHand = null;
        this.activeMoveAnchor = null;
        this.activeMoveCurrentLocal.set(0, 0, 0);
        this.activeMoveYaw = 0;
    }

    private resetAllHandMovement(): void {
        this.handPinchLatched.left = false;
        this.handPinchLatched.right = false;
        this.handTracked.left = false;
        this.handTracked.right = false;
        this.handHovering.left = false;
        this.handHovering.right = false;
        this.handPinchStarted.left = false;
        this.handPinchStarted.right = false;
        this.handCurrentLocal.left.set(0, 0, 0);
        this.handCurrentLocal.right.set(0, 0, 0);
        this.resetActiveMovement();
    }
}
