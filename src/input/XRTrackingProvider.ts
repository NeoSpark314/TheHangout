import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState } from '../interfaces/ITrackingProvider';
import { HandState } from '../models/HandState';
import { HumanoidState } from '../models/HumanoidState';
import { HumanoidJointName } from '../interfaces/IHumanoid';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { RenderManager } from '../managers/RenderManager';

const JOINT_NAMES: XRHandJoint[] = [
    "wrist",
    "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
    "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
    "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
    "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
    "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"
];

const HUMAN_JOINT_MAP: Record<string, Record<XRHandJoint, HumanoidJointName>> = {
    'left': {
        "wrist": "leftHand",
        "thumb-metacarpal": "leftThumbMetacarpal", "thumb-phalanx-proximal": "leftThumbProximal", "thumb-phalanx-distal": "leftThumbDistal", "thumb-tip": "leftThumbTip",
        "index-finger-metacarpal": "leftIndexMetacarpal", "index-finger-phalanx-proximal": "leftIndexProximal", "index-finger-phalanx-intermediate": "leftIndexIntermediate", "index-finger-phalanx-distal": "leftIndexDistal", "index-finger-tip": "leftIndexTip",
        "middle-finger-metacarpal": "leftMiddleMetacarpal", "middle-finger-phalanx-proximal": "leftMiddleProximal", "middle-finger-phalanx-intermediate": "leftMiddleIntermediate", "middle-finger-phalanx-distal": "leftMiddleDistal", "middle-finger-tip": "leftMiddleTip",
        "ring-finger-metacarpal": "leftRingMetacarpal", "ring-finger-phalanx-proximal": "leftRingProximal", "ring-finger-phalanx-intermediate": "leftRingIntermediate", "ring-finger-phalanx-distal": "leftRingDistal", "ring-finger-tip": "leftRingTip",
        "pinky-finger-metacarpal": "leftLittleMetacarpal", "pinky-finger-phalanx-proximal": "leftLittleProximal", "pinky-finger-phalanx-intermediate": "leftLittleIntermediate", "pinky-finger-phalanx-distal": "leftLittleDistal", "pinky-finger-tip": "leftLittleTip"
    },
    'right': {
        "wrist": "rightHand",
        "thumb-metacarpal": "rightThumbMetacarpal", "thumb-phalanx-proximal": "rightThumbProximal", "thumb-phalanx-distal": "rightThumbDistal", "thumb-tip": "rightThumbTip",
        "index-finger-metacarpal": "rightIndexMetacarpal", "index-finger-phalanx-proximal": "rightIndexProximal", "index-finger-phalanx-intermediate": "rightIndexIntermediate", "index-finger-phalanx-distal": "rightIndexDistal", "index-finger-tip": "rightIndexTip",
        "middle-finger-metacarpal": "rightMiddleMetacarpal", "middle-finger-phalanx-proximal": "rightMiddleProximal", "middle-finger-phalanx-intermediate": "rightMiddleIntermediate", "middle-finger-phalanx-distal": "rightMiddleDistal", "middle-finger-tip": "rightMiddleTip",
        "ring-finger-metacarpal": "rightRingMetacarpal", "ring-finger-phalanx-proximal": "rightRingProximal", "ring-finger-phalanx-intermediate": "rightRingIntermediate", "ring-finger-phalanx-distal": "rightRingDistal", "ring-finger-tip": "rightRingTip",
        "pinky-finger-metacarpal": "rightLittleMetacarpal", "pinky-finger-phalanx-proximal": "rightLittleProximal", "pinky-finger-phalanx-intermediate": "rightLittleIntermediate", "pinky-finger-phalanx-distal": "rightLittleDistal", "pinky-finger-tip": "rightLittleTip"
    }
};

export class XRTrackingProvider implements ITrackingProvider {
    public id = 'xr';
    private state: ITrackingState;
    private humanoid: HumanoidState;
    private tempVec = new THREE.Vector3();
    private tempQuat = new THREE.Quaternion();

    constructor(private context: GameContext) {
        this.humanoid = new HumanoidState();
        this.state = this.createInitialState();
    }

    public init(): void { }

    public activate(): void {
        console.log('[XRTrackingProvider] Activated');
    }

    public deactivate(): void {
        console.log('[XRTrackingProvider] Deactivated');
        // Reset active states
        this.state.hands.left.active = false;
        this.state.hands.right.active = false;
        this.state.humanoidDelta = this.humanoid.consumeNetworkDelta() || undefined;
    }

    private clearHand(handedness: 'left' | 'right'): void {
        const map = HUMAN_JOINT_MAP[handedness];
        for (const xrJointName in map) {
            this.humanoid.clearJoint(map[xrJointName as XRHandJoint]);
        }
    }

    private clearFingers(handedness: 'left' | 'right'): void {
        const map = HUMAN_JOINT_MAP[handedness];
        // Skip index 0 (wrist)
        for (let i = 1; i < 25; i++) {
            this.humanoid.clearJoint(map[JOINT_NAMES[i]]);
        }
    }

    private createInitialState(): ITrackingState {
        return {
            head: {
                pose: {
                    position: { x: 0, y: 1.7, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                },
                yaw: 0
            },
            hands: {
                left: new HandState(-0.4),
                right: new HandState(0.4)
            }
        };
    }



    public update(delta: number, frame?: XRFrame): void {
        const managers = this.context.managers;
        const render = managers.render;

        if (!render.isXRPresenting()) return;

        const session = render.getXRSession();
        const xrFrame = frame || render.getXRFrame();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !xrFrame || !referenceSpace) return;

        // 1. Head Tracking (Viewer Pose) - polling directly from RenderManager.camera
        const viewerPose = this.getViewerWorldPose(render, xrFrame, referenceSpace);
        this.state.head = {
            pose: {
                position: viewerPose.position,
                quaternion: viewerPose.quaternion
            },
            yaw: viewerPose.yaw
        };

        // 2. Clear previous active states
        this.state.hands.left.active = false;
        this.state.hands.right.active = false;
        this.state.humanoidDelta = undefined;

        // 3. Choose exactly one source per hand.
        // Prefer controllers over hand-tracking when both are present during transition.
        const selectedSources: Partial<Record<'left' | 'right', XRInputSource>> = {};
        for (let i = 0; i < session.inputSources.length; i++) {
            const source = session.inputSources[i];
            const handedness = source.handedness;
            if (handedness !== 'left' && handedness !== 'right') continue;

            const current = selectedSources[handedness];
            if (!current) {
                selectedSources[handedness] = source;
                continue;
            }

            // Prefer non-hand source (controller) over hand source.
            if (current.hand && !source.hand) {
                selectedSources[handedness] = source;
            }
        }

        const updatedHands = new Set<'left' | 'right'>();
        for (const handedness of ['left', 'right'] as const) {
            const source = selectedSources[handedness];
            if (!source) {
                this.clearHand(handedness);
                continue;
            }

            updatedHands.add(handedness);

            const handState = this.state.hands[handedness];
            handState.hasJoints = !!source.hand;

            // Accuracy Fix: Prefer raw XRFrame pose for controllers and hands to bypass Three.js sync issues.
            if (source.hand) {
                // Full Skeleton Direct Polling: iterate through all 25 joints
                let wristPose: { position: any, quaternion: any } | null = null;
                let validJoints = 0;

                for (let j = 0; j < 25; j++) {
                    const xrJointName = JOINT_NAMES[j];
                    const humanoidJointName = HUMAN_JOINT_MAP[handedness][xrJointName];
                    const joint = source.hand.get(xrJointName);
                    const pose = joint ? xrFrame.getJointPose(joint, referenceSpace) : null;

                    if (pose) {
                        const worldPose = this.rawPoseToWorldPose(pose, render.cameraGroup);

                        // Feed into dirty-sync Humanoid map
                        this.humanoid.setJointPose(humanoidJointName, worldPose.position, worldPose.quaternion);

                        if (j === 0) wristPose = worldPose;
                        validJoints++;
                    } else {
                        // Critical: if a joint is not currently tracked, clear stale state so
                        // remote peers don't keep rendering old finger joints.
                        this.humanoid.clearJoint(humanoidJointName);
                    }
                }

                if (wristPose && validJoints > 0) {
                    handState.active = true;
                    handState.pose.position = wristPose.position;
                    handState.pose.quaternion = wristPose.quaternion;

                    // Pointer Pose for Hand Tracking: Use targetRaySpace (the pinch ray)
                    const pointerPose = source.targetRaySpace ? xrFrame.getPose(source.targetRaySpace, referenceSpace) : null;
                    if (pointerPose) {
                        const worldPointerPose = this.rawPoseToWorldPose(pointerPose, render.cameraGroup);
                        handState.pointerPose.position = worldPointerPose.position;
                        handState.pointerPose.quaternion = worldPointerPose.quaternion;
                    }
                } else {
                    handState.active = false;
                    this.clearHand(handedness);
                }
            } else {
                // Controller-based tracking
                const space = source.gripSpace || source.targetRaySpace;
                const pose = space ? xrFrame.getPose(space, referenceSpace) : null;

                if (pose) {
                    // Valid pose found in frame
                    const worldPose = this.rawPoseToWorldPose(pose, render.cameraGroup);
                    handState.active = true;
                    handState.pose.position = worldPose.position;
                    handState.pose.quaternion = worldPose.quaternion;

                    // Fallback: If no finger tracking, at least put the wrist at the controller so arms stay attached
                    const wristName = HUMAN_JOINT_MAP[handedness]['wrist'];
                    this.humanoid.setJointPose(wristName, worldPose.position, worldPose.quaternion);

                    // Drop fingers since we are holding controllers
                    this.clearFingers(handedness);

                    // Pointer Pose for Controllers: Prefer targetRaySpace
                    // targetRaySpace is the legal "pointing" direction for controllers
                    if (source.targetRaySpace) {
                        const pointerPose = xrFrame.getPose(source.targetRaySpace, referenceSpace);
                        if (pointerPose) {
                            const worldPointerPose = this.rawPoseToWorldPose(pointerPose, render.cameraGroup);
                            handState.pointerPose.position = worldPointerPose.position;
                            handState.pointerPose.quaternion = worldPointerPose.quaternion;
                        }
                    } else {
                        // Fallback to position if no targetRaySpace (rare)
                        handState.pointerPose.position = handState.pose.position;
                        handState.pointerPose.quaternion = handState.pose.quaternion;
                    }
                } else {
                    handState.active = false;
                    this.clearHand(handedness);
                }

                // Reset joints for controller mode
                for (let j = 0; j < 25; j++) {
                    handState.joints[j].pose.position = { x: 0, y: 0, z: 0 };
                    handState.joints[j].pose.quaternion = { x: 0, y: 0, z: 0, w: 1 };
                }
            }
        }

        // 4. Any hands that disappeared from the selected sources need to be cleared
        if (!updatedHands.has('left')) this.clearHand('left');
        if (!updatedHands.has('right')) this.clearHand('right');

        // Emit the aggregated delta chunk for this frame to State and LocalPlayer
        this.state.humanoidDelta = this.humanoid.consumeNetworkDelta() || undefined;
    }

    public getState(): ITrackingState {
        return this.state;
    }

    private getViewerWorldPose(
        render: RenderManager,
        xrFrame: XRFrame,
        referenceSpace: XRReferenceSpace
    ): { position: IVector3, quaternion: IQuaternion, yaw: number } {
        // Source of Truth for head: Three.js camera (already synced to WebXR viewer pose)
        render.camera.getWorldPosition(this.tempVec);
        render.camera.getWorldQuaternion(this.tempQuat);
        const euler = new THREE.Euler().setFromQuaternion(this.tempQuat, 'YXZ');

        return {
            position: { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z },
            quaternion: { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w },
            yaw: euler.y
        };
    }

    private rawPoseToWorldPose(
        pose: XRPose,
        cameraGroup: THREE.Group
    ): { position: IVector3, quaternion: IQuaternion } {
        const orientation = pose.transform.orientation;
        const position = pose.transform.position;

        this.tempVec.set(position.x, position.y, position.z);
        this.tempQuat.set(orientation.x, orientation.y, orientation.z, orientation.w);

        // Transform from reference space to world space using the cameraGroup (XR Origin)
        this.tempVec.applyMatrix4(cameraGroup.matrixWorld);

        // Combine rotations: cameraGroup world orientation * pose orientation
        const groupQuat = new THREE.Quaternion();
        cameraGroup.getWorldQuaternion(groupQuat);
        this.tempQuat.premultiply(groupQuat);

        return {
            position: { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z },
            quaternion: { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w }
        };
    }

    public destroy(): void { }
}
