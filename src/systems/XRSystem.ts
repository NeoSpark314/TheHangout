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
    private tempMatrix2 = new THREE.Matrix4();

    /**
     * @deprecated Use direct XRFrame polling in XRTrackingProvider instead.
     */
    public updateHandPosesFromControllers(
        render: RenderManager,
        handStates: { left: IHandState, right: IHandState },
        leftIndex: number,
        rightIndex: number
    ): void {
        const process = (state: IHandState, index: number) => {
            if (!state.active) return;
            const controller = render.getXRController(index);
            controller.updateMatrixWorld(true);
            controller.getWorldPosition(this.tempVec);
            controller.getWorldQuaternion(this.tempQuat);

            state.position = { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z };
            state.quaternion = { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w };
        };

        process(handStates.left, leftIndex);
        process(handStates.right, rightIndex);
    }

    /**
     * Extracts world-space position and quaternion from any THREE.Object3D.
     * This is the preferred way to get poses from Three.js XR controllers/hands.
     */
    public getWorldPose(object: THREE.Object3D): { position: IVector3, quaternion: IQuaternion } {
        object.updateMatrixWorld(true);
        object.getWorldPosition(this.tempVec);
        object.getWorldQuaternion(this.tempQuat);

        return {
            position: { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z },
            quaternion: { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w }
        };
    }

    public getViewerWorldPose(
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

}
