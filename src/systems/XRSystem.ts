import * as THREE from 'three';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { IHandState } from '../entities/PlayerEntity';
import { RenderManager } from '../managers/RenderManager';

/**
 * Architectural Role: Centralized math hub for XR coordinate transformations.
 * Note: Uses THREE.js classes (IVector3, Matrix4) strictly for spatial math. 
 * This system should remain decoupled from THREE.js scene objects (Meshes, Groups).
 * @deprecated Most logic moved to world-space unification. Use for reference only.
 */
export class XRSystem {
    private tempVec = new THREE.Vector3();
    private tempQuat = new THREE.Quaternion();
    private tempMatrix = new THREE.Matrix4();

    public updateHandPosesFromControllers(
        render: RenderManager,
        handStates: { left: IHandState, right: IHandState },
        leftIndex: number,
        rightIndex: number
    ): void {
        const process = (state: IHandState, index: number) => {
            if (!state.active) return;
            const controller = render.getXRController(index);

            // Critical: Ensure the controller's world matrix is fresh from this frame's WebXR data.
            // This eliminates the 1-frame lag often seen in XR updates.
            controller.updateMatrixWorld(true);
            controller.getWorldPosition(this.tempVec);
            controller.getWorldQuaternion(this.tempQuat);

            state.position = { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z };
            state.quaternion = { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w };
        };

        process(handStates.left, leftIndex);
        process(handStates.right, rightIndex);
    }

    public updateJointsFromXRFrame(
        render: RenderManager,
        xrFrame: XRFrame,
        referenceSpace: XRReferenceSpace,
        session: XRSession,
        handStates: { left: IHandState, right: IHandState }
    ): void {
        const dollyMatrix = render.cameraGroup.matrixWorld;
        const dollyQuat = render.cameraGroup.quaternion;
        const hasHand = { left: false, right: false };

        for (const source of session.inputSources) {
            const handedness = source.handedness as 'left' | 'right';
            if (handedness !== 'left' && handedness !== 'right') continue;

            const state = handStates[handedness];
            if (source.hand && state.active && (xrFrame as any).getJointPose) {
                hasHand[handedness] = true;
                let i = 0;
                for (const joint of (source.hand as any).values()) {
                    if (i >= 25) break;
                    const jointPose = (xrFrame as any).getJointPose(joint, referenceSpace);
                    if (jointPose) {
                        const localPos = this.tempVec.set(jointPose.transform.position.x, jointPose.transform.position.y, jointPose.transform.position.z);
                        const localQuat = this.tempQuat.set(jointPose.transform.orientation.x, jointPose.transform.orientation.y, jointPose.transform.orientation.z, jointPose.transform.orientation.w);

                        const worldPos = localPos.applyMatrix4(dollyMatrix);
                        const worldQuat = localQuat.premultiply(dollyQuat);

                        state.joints[i].position = { x: worldPos.x, y: worldPos.y, z: worldPos.z };
                        state.joints[i].quaternion = { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w };
                    }
                    i++;
                }
            }
        }

        // CRITICAL: Clear joints for hands that are active (e.g. controllers) but don't have hand tracking
        // This prevents transformHandsToAvatarSpace from double-transforming stale local joint data.
        if (!hasHand.left && handStates.left.active) {
            for (let i = 0; i < 25; i++) handStates.left.joints[i].position = { x: 0, y: 0, z: 0 };
        }
        if (!hasHand.right && handStates.right.active) {
            for (let i = 0; i < 25; i++) handStates.right.joints[i].position = { x: 0, y: 0, z: 0 };
        }
    }

    public getViewerWorldPose(
        render: RenderManager,
        xrFrame: XRFrame,
        referenceSpace: XRReferenceSpace
    ): { position: IVector3, quaternion: IQuaternion, yaw: number } {
        const viewerPose = xrFrame.getViewerPose(referenceSpace);
        if (viewerPose) {
            const transform = viewerPose.transform;
            const localPos = this.tempVec.set(transform.position.x, transform.position.y, transform.position.z);
            const localQuat = this.tempQuat.set(transform.orientation.x, transform.orientation.y, transform.orientation.z, transform.orientation.w);

            const dollyMatrix = render.cameraGroup.matrixWorld;
            const worldPos = localPos.applyMatrix4(dollyMatrix);
            const worldQuat = localQuat.premultiply(render.cameraGroup.quaternion);
            const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');

            return {
                position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
                quaternion: { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w },
                yaw: euler.y
            };
        }

        // Fallback to THREE camera if pose not available
        render.camera.getWorldPosition(this.tempVec);
        render.camera.getWorldQuaternion(this.tempQuat);
        const euler = new THREE.Euler().setFromQuaternion(this.tempQuat, 'YXZ');

        return {
            position: { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z },
            quaternion: { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w },
            yaw: euler.y
        };
    }

}
