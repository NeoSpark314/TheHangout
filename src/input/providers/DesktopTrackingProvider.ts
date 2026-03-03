import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import { ITrackingProvider, ITrackingState } from '../../shared/contracts/ITrackingProvider';
import { HandState } from '../../shared/types/HandState';
import { HumanoidState } from '../../shared/types/HumanoidState';
import { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import { LocalPlayer } from '../../world/entities/LocalPlayer';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';

const LERP_SPEED = 15;
const TURN_SENSITIVITY = 15;
const MIN_REACH = 0.2;
const MAX_REACH = 4.0;
const HAND_Y_OFFSET = 0.5;
const HAND_Z_OFFSET = -0.2;
const HAND_X_SPACING = 0.2;

export class DesktopTrackingProvider implements ITrackingProvider {
    public id = 'desktop';
    private state: ITrackingState;
    private humanoid: HumanoidState;

    // Arm stretching state
    private leftStretch = new THREE.Vector3(0, 0, 0);
    private rightStretch = new THREE.Vector3(0, 0, 0);
    private targetLeftStretch = new THREE.Vector3(0, 0, 0);
    private targetRightStretch = new THREE.Vector3(0, 0, 0);

    private leftReach = 1.0;
    private rightReach = 1.0;
    private assistedReach: { left: number | null; right: number | null } = { left: null, right: null };

    /** The most recently activated hand that is still held down. Used for reach adjustment. */
    private prioritizedHand: 'left' | 'right' | null = null;

    private pitch = 0;
    private turnSpeed = 0.002;
    private headHeight = PlayerAvatarEntity.DEFAULT_HEAD_HEIGHT;
    private assistedForwardBase = 0.22;
    private assistedCameraPos = new THREE.Vector3();
    private assistedCameraQuat = new THREE.Quaternion();

    private _lookHandler = (payload: any) => {
        // We only care about Y (pitch) here. 
        // Horizontal look (yaw) is handled by MovementSkill rotating the origin.
        if (this.context.runtime.render.isXRPresenting()) return;
        this.pitch -= payload.delta.y * this.turnSpeed * TURN_SENSITIVITY;
        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
    };

    constructor(private context: AppContext) {
        this.humanoid = new HumanoidState();
        this.state = this.createInitialState();
    }

    public init(): void { }

    public activate(): void {
        eventBus.on(EVENTS.INTENT_LOOK, this._lookHandler);
    }

    public deactivate(): void {
        eventBus.off(EVENTS.INTENT_LOOK, this._lookHandler);

        // Reset all hand stretches
        this.prioritizedHand = null;
        this.targetLeftStretch.set(0, 0, 0);
        this.targetRightStretch.set(0, 0, 0);
        this.leftStretch.set(0, 0, 0);
        this.rightStretch.set(0, 0, 0);
        this.assistedReach.left = null;
        this.assistedReach.right = null;
    }

    private manualStatus = { left: false, right: false };

    public setHandActive(hand: 'left' | 'right', active: boolean): void {
        const handState = this.state.hands[hand];
        this.manualStatus[hand] = active;

        if (active) {
            // Newly activated hand (manually) becomes the prioritized one for scrolling
            this.prioritizedHand = hand;
            this.updateHandTarget(hand);
        } else {
            this.updateHandTarget(hand);

            // If we released the prioritized hand, fall back to the other MANUALLY active hand if it exists
            if (this.prioritizedHand === hand) {
                const otherHand = hand === 'left' ? 'right' : 'left';
                this.prioritizedHand = this.manualStatus[otherHand] ? otherHand : null;
            }
        }

        // On desktop, we keep the hand's logical MUST be active for Interaction proximity checks
        // to work even if not currently "manually extended".
        handState.active = true;
    }

    private updateHandTarget(hand: 'left' | 'right'): void {
        const isManual = this.manualStatus[hand];
        const reach = isManual
            ? (hand === 'left' ? this.leftReach : this.rightReach)
            : this.assistedReach[hand];

        if (hand === 'left') {
            if (reach !== null) this.targetLeftStretch.set(0, 0, -reach);
            else this.targetLeftStretch.set(0, 0, 0);
        } else {
            if (reach !== null) this.targetRightStretch.set(0, 0, -reach);
            else this.targetRightStretch.set(0, 0, 0);
        }
    }

    public adjustReach(delta: number): void {
        const hand = this.prioritizedHand;
        if (!hand) return;

        if (hand === 'left') {
            this.leftReach = Math.max(MIN_REACH, Math.min(MAX_REACH, this.leftReach + delta));
            this.updateHandTarget('left');
        } else {
            this.rightReach = Math.max(MIN_REACH, Math.min(MAX_REACH, this.rightReach + delta));
            this.updateHandTarget('right');
        }
    }

    public setAssistedReach(hand: 'left' | 'right', reach: number | null): void {
        const clamped = reach === null ? null : Math.max(0, Math.min(MAX_REACH, reach));
        this.assistedReach[hand] = clamped;
        if (!this.manualStatus[hand]) {
            this.updateHandTarget(hand);
        }
    }

    private createInitialState(): ITrackingState {
        return {
            head: {
                pose: {
                    position: { x: 0, y: this.headHeight, z: 0 },
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

        const lp = this.context.localPlayer as LocalPlayer;
        if (!lp || lp.type !== 'LOCAL_PLAYER') return;

        // 1. Source of Truth: Origin and Orientation
        const originPos = new THREE.Vector3(lp.xrOrigin.position.x, lp.xrOrigin.position.y, lp.xrOrigin.position.z);
        const originQuat = new THREE.Quaternion(lp.xrOrigin.quaternion.x, lp.xrOrigin.quaternion.y, lp.xrOrigin.quaternion.z, lp.xrOrigin.quaternion.w);

        // Calculate Head-Local Pose (height + pitch)
        const localHeadPos = new THREE.Vector3(0, this.headHeight, 0);
        const localHeadQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, 0, 0, 'YXZ'));

        // Combine to World Space
        const worldHeadPos = localHeadPos.clone().applyQuaternion(originQuat).add(originPos);
        const worldHeadQuat = originQuat.clone().multiply(localHeadQuat);

        this.state.head = {
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
        const leftBaseOffset = new THREE.Vector3(-HAND_X_SPACING, this.headHeight - HAND_Y_OFFSET, HAND_Z_OFFSET);
        const rightBaseOffset = new THREE.Vector3(HAND_X_SPACING, this.headHeight - HAND_Y_OFFSET, HAND_Z_OFFSET);

        const leftBaseWorld = leftBaseOffset.clone().applyQuaternion(originQuat).add(originPos);
        const rightBaseWorld = rightBaseOffset.clone().applyQuaternion(originQuat).add(originPos);

        // Apply stretch in the direction the HEAD is looking (worldHeadQuat)
        let leftTargetWorld = leftBaseWorld.clone().add(this.leftStretch.clone().applyQuaternion(worldHeadQuat));
        let rightTargetWorld = rightBaseWorld.clone().add(this.rightStretch.clone().applyQuaternion(worldHeadQuat));

        // Assisted non-VR reach follows the exact rendered camera center line.
        // Using the actual camera transform avoids any discrepancy between the
        // reconstructed head pose and what the player is currently seeing.
        if ((!this.manualStatus.left && this.assistedReach.left !== null) || (!this.manualStatus.right && this.assistedReach.right !== null)) {
            render.camera.getWorldPosition(this.assistedCameraPos);
            render.camera.getWorldQuaternion(this.assistedCameraQuat);
        }
        if (!this.manualStatus.left && this.assistedReach.left !== null) {
            const assistForward = new THREE.Vector3(0, 0, -(this.assistedForwardBase + this.assistedReach.left));
            leftTargetWorld = this.assistedCameraPos.clone().add(assistForward.applyQuaternion(this.assistedCameraQuat));
        }
        if (!this.manualStatus.right && this.assistedReach.right !== null) {
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

        // Map base hand targets directly to the Humanoid sync state
        // Desktop hands are always 'active' effectively for networking
        this.humanoid.setJointPose('leftHand', leftTargetWorld, worldHeadQuat);
        this.humanoid.setJointPose('rightHand', rightTargetWorld, worldHeadQuat);

        this.state.humanoidDelta = this.humanoid.consumeNetworkDelta() || undefined;
    }

    public getState(): ITrackingState {
        return this.state;
    }

    public destroy(): void {
        this.deactivate();
    }
}
