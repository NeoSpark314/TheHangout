import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState } from '../entities/PlayerEntity';

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
                position: { x: 0, y: 1.7, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                yaw: 0
            },
            hands: {
                left: this.createEmptyHandState(-0.4),
                right: this.createEmptyHandState(0.4)
            }
        };
    }

    private createEmptyHandState(offsetX: number): IHandState {
        const state: IHandState = {
            active: false,
            hasJoints: false,
            position: { x: offsetX, y: 0.8, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            joints: []
        };
        for (let i = 0; i < 25; i++) {
            state.joints.push({
                position: { x: 0, y: 0, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            });
        }
        return state;
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
        this.state.head = xr.getViewerWorldPose(render, xrFrame, referenceSpace);

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
                        handState.joints[j].position = worldPose.position;
                        handState.joints[j].quaternion = worldPose.quaternion;

                        if (j === 0) wristPose = worldPose;
                        validJoints++;
                    }
                }

                if (wristPose && validJoints > 0) {
                    handState.active = true;
                    handState.position = wristPose.position;
                    handState.quaternion = wristPose.quaternion;
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
                    handState.position = worldPose.position;
                    handState.quaternion = worldPose.quaternion;
                } else {
                    // Fail-Safe: If session started but no pose yet, stay inactive
                    // DO NOT fallback to render.getXRController(i) as the index 'i'
                    // is unreliable and often points to uninitialized Three.js groups.
                    handState.active = false;
                }

                // Reset joints for controller mode
                for (let j = 0; j < 25; j++) {
                    handState.joints[j].position = { x: 0, y: 0, z: 0 };
                    handState.joints[j].quaternion = { x: 0, y: 0, z: 0, w: 1 };
                }
            }
        }
    }

    public getState(): ITrackingState {
        return this.state;
    }

    public destroy(): void { }
}
