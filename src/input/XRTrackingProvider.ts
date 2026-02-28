import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState } from '../interfaces/ITrackingProvider';
import { HandState } from '../models/HandState';

const JOINT_NAMES: XRHandJoint[] = [
    "wrist",
    "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
    "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
    "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
    "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
    "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"
];

export class XRTrackingProvider implements ITrackingProvider {
    public id = 'xr';
    private state: ITrackingState;
    constructor(private context: GameContext) {
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
        const xr = managers.xr;

        if (!render.isXRPresenting()) return;

        const session = render.getXRSession();
        const xrFrame = frame || render.getXRFrame();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !xrFrame || !referenceSpace) return;

        // 1. Head Tracking (Viewer Pose) - delegating to XRSystem which uses RenderManager.camera
        const viewerPose = xr.getViewerWorldPose(render, xrFrame, referenceSpace);
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

        // 3. Poll Input Sources and map them to Three.js XR objects
        for (let i = 0; i < session.inputSources.length; i++) {
            const source = session.inputSources[i];
            const handedness = source.handedness;
            if (handedness !== 'left' && handedness !== 'right') continue;

            const handState = this.state.hands[handedness];
            handState.hasJoints = !!source.hand;

            // Accuracy Fix: Prefer raw XRFrame pose for controllers and hands to bypass Three.js sync issues.
            if (source.hand) {
                // Full Skeleton Direct Polling: iterate through all 25 joints
                let wristPose: { position: any, quaternion: any } | null = null;
                let validJoints = 0;

                for (let j = 0; j < 25; j++) {
                    const jointName = JOINT_NAMES[j];
                    const joint = source.hand.get(jointName);
                    const pose = joint ? xrFrame.getJointPose(joint, referenceSpace) : null;

                    if (pose) {
                        const worldPose = xr.rawPoseToWorldPose(pose, render.cameraGroup);
                        handState.joints[j].pose.position = worldPose.position;
                        handState.joints[j].pose.quaternion = worldPose.quaternion;

                        if (j === 0) wristPose = worldPose;
                        validJoints++;
                    }
                }

                if (wristPose && validJoints > 0) {
                    handState.active = true;
                    handState.pose.position = wristPose.position;
                    handState.pose.quaternion = wristPose.quaternion;

                    // Pointer Pose for Hand Tracking: Use targetRaySpace (the pinch ray)
                    const pointerPose = source.targetRaySpace ? xrFrame.getPose(source.targetRaySpace, referenceSpace) : null;
                    if (pointerPose) {
                        const worldPointerPose = xr.rawPoseToWorldPose(pointerPose, render.cameraGroup);
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
                    const worldPose = xr.rawPoseToWorldPose(pose, render.cameraGroup);
                    handState.active = true;
                    handState.pose.position = worldPose.position;
                    handState.pose.quaternion = worldPose.quaternion;

                    // Pointer Pose for Controllers: Prefer targetRaySpace
                    // targetRaySpace is the legal "pointing" direction for controllers
                    if (source.targetRaySpace) {
                        const pointerPose = xrFrame.getPose(source.targetRaySpace, referenceSpace);
                        if (pointerPose) {
                            const worldPointerPose = xr.rawPoseToWorldPose(pointerPose, render.cameraGroup);
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
    }

    public getState(): ITrackingState {
        return this.state;
    }

    public destroy(): void { }
}
