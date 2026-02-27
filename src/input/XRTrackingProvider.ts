import * as THREE from 'three';
import { GameContext } from '../core/GameState';
import { ITrackingProvider, ITrackingState } from '../interfaces/ITrackingProvider';
import { IHandState } from '../entities/PlayerEntity';

export class XRTrackingProvider implements ITrackingProvider {
    public id = 'xr';
    private state: ITrackingState;
    private leftControllerIndex: number = 0;
    private rightControllerIndex: number = 1;

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

        // 1. Head Tracking (Viewer Pose)
        this.state.head = xr.getViewerWorldPose(render, xrFrame, referenceSpace);

        // 2. Poll Input Sources for Controllers/Hands
        this.state.hands.left.active = false;
        this.state.hands.right.active = false;

        let controllerIndex = 0;
        for (const source of session.inputSources) {
            if (source.handedness === 'left') {
                this.leftControllerIndex = controllerIndex;
                this.state.hands.left.active = true;
            } else if (source.handedness === 'right') {
                this.rightControllerIndex = controllerIndex;
                this.state.hands.right.active = true;
            }

            // Only increment controllerIndex for sources that Three.js treats as "controllers" 
            if (source.targetRayMode === 'tracked-pointer' || source.targetRayMode === 'screen' || source.hand) {
                controllerIndex++;
            }
        }

        // 3. Update Poses and Joints via XRSystem
        xr.updateHandPosesFromControllers(
            render,
            this.state.hands,
            this.leftControllerIndex,
            this.rightControllerIndex
        );

        xr.updateJointsFromXRFrame(
            render,
            xrFrame,
            referenceSpace,
            session,
            this.state.hands
        );
    }

    public getState(): ITrackingState {
        return this.state;
    }

    public destroy(): void { }
}
