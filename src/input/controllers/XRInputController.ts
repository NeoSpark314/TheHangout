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

export class XRInputManager {
    public move: { x: number, y: number } = { x: 0, y: 0 };
    public turn: number = 0;
    private leftHandPinchLatched = false;
    private leftHandMoveActive = false;
    private leftHandMoveAnchor: THREE.Vector3 | null = null;
    private leftHandMoveCurrentWorld: THREE.Vector3 | null = null;
    private leftHandMoveCurrentLocal = new THREE.Vector3();
    private leftHandMoveHovering = false;
    private leftHandMoveYaw = 0;
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

    public poll(frame?: XRFrame): void {
        this.move = { x: 0, y: 0 };
        this.turn = 0;

        const render = this.context.runtime.render;
        if (!render || !render.isXRPresenting()) {
            this.resetLeftHandMovement();
            return;
        }

        const session = render.getXRSession();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !referenceSpace) {
            this.resetLeftHandMovement();
            return;
        }

        let sawLeftHandSource = false;
        for (const source of session.inputSources) {
            if (source.handedness === 'left' && source.hand) {
                sawLeftHandSource = true;
                this.pollLeftHandMovement(source, frame, referenceSpace);
            }

            if (source.gamepad) {
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

        if (!sawLeftHandSource) {
            this.resetLeftHandMovement();
        }
    }

    private pollLeftHandMovement(
        source: XRInputSource,
        frame: XRFrame | undefined,
        referenceSpace: XRReferenceSpace
    ): void {
        const render = this.context.runtime.render;
        if (!frame) {
            this.resetLeftHandMovement();
            return;
        }

        const pinchPoint = this.getHandPinchPoint(source, frame, referenceSpace);
        if (!pinchPoint) {
            this.resetLeftHandMovement();
            return;
        }

        this.leftHandMoveCurrentWorld = pinchPoint.clone();

        const currentYaw = this.getHeadYaw();
        const currentActivationOffset = this.getActivationLocalOffset(pinchPoint, currentYaw);
        this.leftHandMoveCurrentLocal.copy(currentActivationOffset);
        this.leftHandMoveHovering = currentActivationOffset.lengthSq() <= (this.handActivationRadius * this.handActivationRadius);

        const pinchDistance = this.getHandPinchDistance(source, frame, referenceSpace);
        const g = INPUT_CONFIG.GESTURE;
        const nextPinchState = GestureUtils.updateDistanceLatch(this.leftHandPinchLatched, pinchDistance, {
            on: g.PINCH_ON_DISTANCE,
            off: g.PINCH_OFF_DISTANCE
        });
        const pinchStarted = !this.leftHandPinchLatched && nextPinchState;
        this.leftHandPinchLatched = nextPinchState;

        if (!nextPinchState) {
            if (this.leftHandMoveActive) {
                this.resetLeftHandMovement();
                this.leftHandMoveCurrentWorld = pinchPoint.clone();
                this.leftHandMoveCurrentLocal.copy(currentActivationOffset);
                this.leftHandMoveHovering = currentActivationOffset.lengthSq() <= (this.handActivationRadius * this.handActivationRadius);
            }
            return;
        }

        if (this.leftHandMoveActive) {
            const pinnedActivationOffset = this.getActivationLocalOffset(pinchPoint, this.leftHandMoveYaw);
            this.leftHandMoveCurrentLocal.copy(pinnedActivationOffset);
            this._localDelta.copy(pinnedActivationOffset).sub(this.leftHandMoveAnchor!);
            this._localDelta.y = 0;
        } else if (pinchStarted && this.leftHandMoveHovering) {
            this.leftHandMoveActive = true;
            this.leftHandMoveAnchor = currentActivationOffset.clone();
            this.leftHandMoveCurrentLocal.copy(currentActivationOffset);
            this.leftHandMoveYaw = currentYaw;
            this._localDelta.set(0, 0, 0);
        } else {
            return;
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
        if (!this.leftHandMoveCurrentWorld) {
            return null;
        }

        const anchor = this.leftHandMoveActive && this.leftHandMoveAnchor
            ? this.leftHandMoveAnchor
            : this.leftHandMoveCurrentLocal;

        return {
            visible: true,
            isActive: this.leftHandMoveActive,
            showMotion: this.leftHandMoveActive &&
                Math.hypot(
                    this.leftHandMoveCurrentLocal.x - anchor.x,
                    this.leftHandMoveCurrentLocal.z - anchor.z
                ) > this.handMoveDeadzone,
            isHovering: this.leftHandMoveHovering,
            frameYaw: this.leftHandMoveActive ? this.leftHandMoveYaw : this.getHeadYaw(),
            centerOffsetHeadLocal: {
                x: this.handActivationCenter.x,
                y: this.handActivationCenter.y,
                z: this.handActivationCenter.z
            },
            anchorLocal: { x: anchor.x, y: anchor.y, z: anchor.z },
            currentLocal: {
                x: this.leftHandMoveCurrentLocal.x,
                y: this.leftHandMoveCurrentLocal.y,
                z: this.leftHandMoveCurrentLocal.z
            },
            radius: this.handActivationRadius
        };
    }

    private resetLeftHandMovement(): void {
        this.leftHandPinchLatched = false;
        this.leftHandMoveActive = false;
        this.leftHandMoveAnchor = null;
        this.leftHandMoveCurrentWorld = null;
        this.leftHandMoveCurrentLocal.set(0, 0, 0);
        this.leftHandMoveHovering = false;
        this.leftHandMoveYaw = 0;
    }
}
