import * as THREE from 'three';
import { AppContext } from '../../app/AppContext';
import { ITrackingProvider, ITrackingState } from '../../shared/contracts/ITrackingProvider';
import { HandState } from '../../shared/types/HandState';
import { IVector3, IQuaternion } from '../../shared/contracts/IMath';
import { RenderRuntime } from '../../render/runtime/RenderRuntime';
import { AvatarSkeletonJointName, IAvatarTrackingFrame } from '../../shared/avatar/AvatarSkeleton';
import { convertRawWorldQuaternionToAvatarWorldQuaternion } from '../../shared/avatar/AvatarTrackingSpace';

const JOINT_NAMES: XRHandJoint[] = [
    "wrist",
    "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
    "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
    "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
    "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
    "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"
];

const XR_TO_AVATAR_JOINT_MAP: Record<'left' | 'right', Record<XRHandJoint, AvatarSkeletonJointName>> = {
    left: {
        "wrist": "leftHand",
        "thumb-metacarpal": "leftThumbMetacarpal", "thumb-phalanx-proximal": "leftThumbProximal", "thumb-phalanx-distal": "leftThumbDistal", "thumb-tip": "leftThumbTip",
        "index-finger-metacarpal": "leftIndexMetacarpal", "index-finger-phalanx-proximal": "leftIndexProximal", "index-finger-phalanx-intermediate": "leftIndexIntermediate", "index-finger-phalanx-distal": "leftIndexDistal", "index-finger-tip": "leftIndexTip",
        "middle-finger-metacarpal": "leftMiddleMetacarpal", "middle-finger-phalanx-proximal": "leftMiddleProximal", "middle-finger-phalanx-intermediate": "leftMiddleIntermediate", "middle-finger-phalanx-distal": "leftMiddleDistal", "middle-finger-tip": "leftMiddleTip",
        "ring-finger-metacarpal": "leftRingMetacarpal", "ring-finger-phalanx-proximal": "leftRingProximal", "ring-finger-phalanx-intermediate": "leftRingIntermediate", "ring-finger-phalanx-distal": "leftRingDistal", "ring-finger-tip": "leftRingTip",
        "pinky-finger-metacarpal": "leftLittleMetacarpal", "pinky-finger-phalanx-proximal": "leftLittleProximal", "pinky-finger-phalanx-intermediate": "leftLittleIntermediate", "pinky-finger-phalanx-distal": "leftLittleDistal", "pinky-finger-tip": "leftLittleTip"
    },
    right: {
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
    private tempVec = new THREE.Vector3();
    private tempQuat = new THREE.Quaternion();

    constructor(private context: AppContext) {
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
    }

    private createInitialState(): ITrackingState {
        return {
            head: {
                localPose: {
                    position: { x: 0, y: 1.7, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                },
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
        const runtime = this.context.runtime;
        const render = runtime.render;

        if (!render.isXRPresenting()) return;

        const session = render.getXRSession();
        const xrFrame = frame || render.getXRFrame();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !xrFrame || !referenceSpace) return;

        // 1. Head Tracking (Viewer Pose) - polling directly from RenderRuntime.camera
        const viewerPose = this.getViewerWorldPose(render, xrFrame, referenceSpace);
        const localPlayer = this.context.localPlayer;
        const rootPosition = localPlayer?.xrOrigin.position ?? viewerPose.position;
        const rootQuaternion = localPlayer?.xrOrigin.quaternion ?? viewerPose.quaternion;
        const avatarRootQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion(rootQuaternion);
        const avatarHeadQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion(viewerPose.quaternion);
        const trackingFrame: IAvatarTrackingFrame = {
            rootWorldPosition: { ...rootPosition },
            rootWorldQuaternion: avatarRootQuaternion,
            headWorldPose: {
                position: viewerPose.position,
                quaternion: avatarHeadQuaternion
            },
            effectors: {},
            tracked: {
                head: true
            },
            seated: false
        };
        this.state.head = {
            localPose: {
                position: { x: render.camera.position.x, y: render.camera.position.y, z: render.camera.position.z },
                quaternion: { x: render.camera.quaternion.x, y: render.camera.quaternion.y, z: render.camera.quaternion.z, w: render.camera.quaternion.w }
            },
            pose: {
                position: viewerPose.position,
                quaternion: viewerPose.quaternion
            },
            yaw: viewerPose.yaw
        };

        // 2. Clear previous active states
        this.state.hands.left.active = false;
        this.state.hands.right.active = false;

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
                    const humanoidJointName = XR_TO_AVATAR_JOINT_MAP[handedness][xrJointName];
                    const joint = source.hand.get(xrJointName);
                    const pose = joint ? xrFrame.getJointPose(joint, referenceSpace) : null;

                    if (pose) {
                        const worldPose = this.rawPoseToWorldPose(pose, render.cameraGroup);
                        const avatarQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion(worldPose.quaternion);

                        trackingFrame.effectors[humanoidJointName] = {
                            position: worldPose.position,
                            quaternion: avatarQuaternion
                        };
                        trackingFrame.tracked[humanoidJointName] = true;
                        // Keep per-hand joint array in sync for gesture detection (pinch/fist).
                        handState.joints[j].pose.position = worldPose.position;
                        handState.joints[j].pose.quaternion = worldPose.quaternion;

                        if (j === 0) wristPose = worldPose;
                        validJoints++;
                    } else {
                        handState.joints[j].pose.position = { x: 0, y: 0, z: 0 };
                        handState.joints[j].pose.quaternion = { x: 0, y: 0, z: 0, w: 1 };
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
                }
            } else {
                // Controller-based tracking
                const space = source.gripSpace || source.targetRaySpace;
                const pose = space ? xrFrame.getPose(space, referenceSpace) : null;

                if (pose) {
                    // Valid pose found in frame
                    const worldPose = this.rawPoseToWorldPose(pose, render.cameraGroup);
                    const avatarQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion(worldPose.quaternion);
                    handState.active = true;
                    handState.pose.position = worldPose.position;
                    handState.pose.quaternion = worldPose.quaternion;

                    const wristName = handedness === 'left' ? 'leftHand' : 'rightHand';
                    trackingFrame.effectors[wristName] = {
                        position: worldPose.position,
                        quaternion: avatarQuaternion
                    };
                    trackingFrame.tracked[wristName] = true;

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
                }

                // Reset joints for controller mode
                for (let j = 0; j < 25; j++) {
                    handState.joints[j].pose.position = { x: 0, y: 0, z: 0 };
                    handState.joints[j].pose.quaternion = { x: 0, y: 0, z: 0, w: 1 };
                }
            }
        }

        this.state.avatarTrackingFrame = trackingFrame;
    }

    public getState(): ITrackingState {
        return this.state;
    }

    private getViewerWorldPose(
        render: RenderRuntime,
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
