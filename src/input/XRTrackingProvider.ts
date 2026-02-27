import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState } from '../entities/PlayerEntity';

export class XRTrackingProvider implements ITrackingProvider {
    public id = 'xr';
    private state: ITrackingState;
    constructor(private context: GameContext) {
        this.state = this.createInitialState();
    }

    public init(): void { }

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
            handState.active = true;

            // Accuracy Fix: Prefer raw XRFrame pose for controllers to bypass Three.js sync issues.
            // Only use Three.js handObj for skeletal tracking data.
            if (source.hand) {
                const handObj = render.getXRHand(i);
                const handPose = xr.getWorldPose(handObj);
                handState.position = handPose.position;
                handState.quaternion = handPose.quaternion;
            } else {
                const space = source.gripSpace || source.targetRaySpace;
                const pose = space ? xrFrame.getPose(space, referenceSpace) : null;
                if (pose) {
                    const worldPose = xr.rawPoseToWorldPose(pose, render.cameraGroup);
                    handState.position = worldPose.position;
                    handState.quaternion = worldPose.quaternion;

                    // Debug Log: Log pose every 60 frames (~once per second)
                    if (Math.random() < 0.01) {
                        console.log(`[XRTrackingProvider] ${handedness} controller world pos:`,
                            handState.position.x.toFixed(2),
                            handState.position.y.toFixed(2),
                            handState.position.z.toFixed(2));
                    }
                } else {
                    // Fallback to Three.js object if frame pose is unavailable
                    const fallbackObj = source.gripSpace ? render.getXRControllerGrip(i) : render.getXRController(i);
                    const fallbackPose = xr.getWorldPose(fallbackObj);
                    handState.position = fallbackPose.position;
                    handState.quaternion = fallbackPose.quaternion;
                }
            }

            // 4. Update Hand Joints if hand tracking is available
            if (source.hand) {
                const handObj = render.getXRHand(i);
                if (handObj.children.length > 0) {
                    // Three.js Hand object contains 25 joints as children
                    // We map them directly to our simplified joint array
                    for (let j = 0; j < 25; j++) {
                        const jointObj = handObj.children[j];
                        if (jointObj) {
                            const jointPose = xr.getWorldPose(jointObj);
                            handState.joints[j].position = jointPose.position;
                            handState.joints[j].quaternion = jointPose.quaternion;
                        }
                    }
                }
            } else {
                // Reset joints if no skeletal data to prevent floating bones
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
