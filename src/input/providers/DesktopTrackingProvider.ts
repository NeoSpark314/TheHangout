import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import { ITrackingProvider, ITrackingState } from '../../shared/contracts/ITrackingProvider';
import { HandState } from '../../shared/types/HandState';
import { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { ILookIntentPayload } from '../../shared/contracts/IIntents';
import { IAvatarTrackingFrame } from '../../shared/avatar/AvatarSkeleton';
import { convertRawWorldQuaternionToAvatarWorldQuaternion } from '../../shared/avatar/AvatarTrackingSpace';
import { estimateStandingEyeHeightM } from '../../shared/avatar/AvatarMetrics';

const LERP_SPEED = 15;
const MAX_REACH = 4.0;
const HAND_Y_OFFSET = 0.5;
const HAND_Z_OFFSET = -0.2;
const HAND_X_SPACING = 0.2;

export class DesktopTrackingProvider implements ITrackingProvider {
    public id = 'desktop';
    private state: ITrackingState;

    // Arm stretching state
    private leftStretch = new THREE.Vector3(0, 0, 0);
    private rightStretch = new THREE.Vector3(0, 0, 0);
    private targetLeftStretch = new THREE.Vector3(0, 0, 0);
    private targetRightStretch = new THREE.Vector3(0, 0, 0);

    private assistedReach: { left: number | null; right: number | null } = { left: null, right: null };

    private pitch = 0;
    private yaw = 0;
    private assistedForwardBase = 0.22;
    private assistedCameraPos = new THREE.Vector3();
    private assistedCameraQuat = new THREE.Quaternion();

    private _lookHandler = (payload: ILookIntentPayload) => {
        this.yaw -= payload.yawDeltaRad;
        if (this.context.runtime.render.isXRPresenting()) return;
        this.pitch -= payload.pitchDeltaRad;
        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
    };

    constructor(private context: AppContext) {
        this.state = this.createInitialState();
    }

    public init(): void { }

    public activate(): void {
        eventBus.on(EVENTS.INTENT_LOOK, this._lookHandler);
    }

    public deactivate(): void {
        eventBus.off(EVENTS.INTENT_LOOK, this._lookHandler);

        // Reset all hand stretches
        this.targetLeftStretch.set(0, 0, 0);
        this.targetRightStretch.set(0, 0, 0);
        this.leftStretch.set(0, 0, 0);
        this.rightStretch.set(0, 0, 0);
        this.assistedReach.left = null;
        this.assistedReach.right = null;
        this.yaw = 0;
    }

    private updateHandTarget(hand: 'left' | 'right'): void {
        const reach = this.assistedReach[hand];

        if (hand === 'left') {
            if (reach !== null) this.targetLeftStretch.set(0, 0, -reach);
            else this.targetLeftStretch.set(0, 0, 0);
        } else {
            if (reach !== null) this.targetRightStretch.set(0, 0, -reach);
            else this.targetRightStretch.set(0, 0, 0);
        }
    }

    public setAssistedReach(hand: 'left' | 'right', reach: number | null): void {
        const clamped = reach === null ? null : Math.max(0, Math.min(MAX_REACH, reach));
        this.assistedReach[hand] = clamped;
        this.updateHandTarget(hand);
    }

    private createInitialState(): ITrackingState {
        const headHeight = this.getHeadHeight();
        return {
            head: {
                localPose: {
                    position: { x: 0, y: headHeight, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                },
                pose: {
                    position: { x: 0, y: headHeight, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                },
                yaw: 0
            },
            hands: {
                left: new HandState(-0.4, true),
                right: new HandState(0.4, true)
            }
        };
    }



    public update(delta: number): void {
        const runtime = this.context.runtime;
        const render = runtime.render;

        if (render.isXRPresenting()) return;

        const lp = this.context.localPlayer as PlayerAvatarEntity;
        if (!lp || lp.controlMode !== 'local') return;
        const headHeight = this.getHeadHeight();

        // 1. Source of Truth: Origin and Orientation
        const originPos = new THREE.Vector3(lp.xrOrigin.position.x, lp.xrOrigin.position.y, lp.xrOrigin.position.z);
        const originQuat = new THREE.Quaternion(lp.xrOrigin.quaternion.x, lp.xrOrigin.quaternion.y, lp.xrOrigin.quaternion.z, lp.xrOrigin.quaternion.w);

        // Calculate Head-Local Pose (height + pitch)
        const localHeadPos = new THREE.Vector3(0, headHeight, 0);
        const localHeadQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

        // Combine to World Space
        const worldHeadPos = localHeadPos.clone().applyQuaternion(originQuat).add(originPos);
        const worldHeadQuat = originQuat.clone().multiply(localHeadQuat);
        const avatarRootQuat = convertRawWorldQuaternionToAvatarWorldQuaternion(lp.xrOrigin.quaternion);
        const avatarHeadQuat = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: worldHeadQuat.x,
            y: worldHeadQuat.y,
            z: worldHeadQuat.z,
            w: worldHeadQuat.w
        });
        const trackingFrame: IAvatarTrackingFrame = {
            rootWorldPosition: { x: originPos.x, y: originPos.y, z: originPos.z },
            rootWorldQuaternion: avatarRootQuat,
            headWorldPose: {
                position: { x: worldHeadPos.x, y: worldHeadPos.y, z: worldHeadPos.z },
                quaternion: avatarHeadQuat
            },
            effectors: {},
            tracked: {
                head: true
            },
            seated: false
        };

        this.state.head = {
            localPose: {
                position: { x: localHeadPos.x, y: localHeadPos.y, z: localHeadPos.z },
                quaternion: { x: localHeadQuat.x, y: localHeadQuat.y, z: localHeadQuat.z, w: localHeadQuat.w }
            },
            pose: {
                position: { x: worldHeadPos.x, y: worldHeadPos.y, z: worldHeadPos.z },
                quaternion: { x: worldHeadQuat.x, y: worldHeadQuat.y, z: worldHeadQuat.z, w: worldHeadQuat.w },
            },
            yaw: new THREE.Euler().setFromQuaternion(worldHeadQuat, 'YXZ').y
        };

        // 2. Update Arm Stretching (Lerp for smoothness)
        this.leftStretch.lerp(this.targetLeftStretch, delta * LERP_SPEED);
        this.rightStretch.lerp(this.targetRightStretch, delta * LERP_SPEED);

        // 3. Update Hand Poses relative to physical body (Origin)
        // Base hand positions (Lowered Y relative to head-local)
        // Note: we apply origin rotation to these offsets
        const leftBaseOffset = new THREE.Vector3(-HAND_X_SPACING, headHeight - HAND_Y_OFFSET, HAND_Z_OFFSET);
        const rightBaseOffset = new THREE.Vector3(HAND_X_SPACING, headHeight - HAND_Y_OFFSET, HAND_Z_OFFSET);

        const leftBaseWorld = leftBaseOffset.clone().applyQuaternion(originQuat).add(originPos);
        const rightBaseWorld = rightBaseOffset.clone().applyQuaternion(originQuat).add(originPos);

        // Apply stretch in the direction the HEAD is looking (worldHeadQuat)
        let leftTargetWorld = leftBaseWorld.clone().add(this.leftStretch.clone().applyQuaternion(worldHeadQuat));
        let rightTargetWorld = rightBaseWorld.clone().add(this.rightStretch.clone().applyQuaternion(worldHeadQuat));

        // Assisted non-VR reach follows the exact rendered camera center line.
        // Using the actual camera transform avoids any discrepancy between the
        // reconstructed head pose and what the player is currently seeing.
        if (this.assistedReach.left !== null || this.assistedReach.right !== null) {
            render.camera.getWorldPosition(this.assistedCameraPos);
            render.camera.getWorldQuaternion(this.assistedCameraQuat);
        }
        if (this.assistedReach.left !== null) {
            const assistForward = new THREE.Vector3(0, 0, -(this.assistedForwardBase + this.assistedReach.left));
            leftTargetWorld = this.assistedCameraPos.clone().add(assistForward.applyQuaternion(this.assistedCameraQuat));
        }
        if (this.assistedReach.right !== null) {
            const assistForward = new THREE.Vector3(0, 0, -(this.assistedForwardBase + this.assistedReach.right));
            rightTargetWorld = this.assistedCameraPos.clone().add(assistForward.applyQuaternion(this.assistedCameraQuat));
        }

        this.state.hands.left.pose.position = { x: leftTargetWorld.x, y: leftTargetWorld.y, z: leftTargetWorld.z };
        this.state.hands.left.pose.quaternion = { x: worldHeadQuat.x, y: worldHeadQuat.y, z: worldHeadQuat.z, w: worldHeadQuat.w };
        this.state.hands.left.pointerPose.position = { ...this.state.hands.left.pose.position };
        this.state.hands.left.pointerPose.quaternion = { ...this.state.hands.left.pose.quaternion };
        this.state.hands.left.joints.forEach(j => {
            j.pose.position = { ...this.state.hands.left.pose.position };
            j.pose.quaternion = { ...this.state.hands.left.pose.quaternion };
        });

        this.state.hands.right.pose.position = { x: rightTargetWorld.x, y: rightTargetWorld.y, z: rightTargetWorld.z };
        this.state.hands.right.pose.quaternion = { x: worldHeadQuat.x, y: worldHeadQuat.y, z: worldHeadQuat.z, w: worldHeadQuat.w };
        this.state.hands.right.pointerPose.position = { ...this.state.hands.right.pose.position };
        this.state.hands.right.pointerPose.quaternion = { ...this.state.hands.right.pose.quaternion };
        this.state.hands.right.joints.forEach(j => {
            j.pose.position = { ...this.state.hands.right.pose.position };
            j.pose.quaternion = { ...this.state.hands.right.pose.quaternion };
        });

        trackingFrame.effectors.leftHand = {
            position: { x: leftTargetWorld.x, y: leftTargetWorld.y, z: leftTargetWorld.z },
            quaternion: avatarHeadQuat
        };
        trackingFrame.effectors.rightHand = {
            position: { x: rightTargetWorld.x, y: rightTargetWorld.y, z: rightTargetWorld.z },
            quaternion: avatarHeadQuat
        };
        trackingFrame.tracked.leftHand = true;
        trackingFrame.tracked.rightHand = true;

        this.state.avatarTrackingFrame = trackingFrame;
    }

    public getState(): ITrackingState {
        return this.state;
    }

    public destroy(): void {
        this.deactivate();
    }

    private getHeadHeight(): number {
        return estimateStandingEyeHeightM(this.context.avatarConfig.playerHeightM);
    }
}
