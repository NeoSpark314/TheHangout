import * as THREE from 'three';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { IHandState } from '../interfaces/ITrackingProvider';
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

    /**
     * Converts a raw XRPose from the WebXR frame into world space.
     * Use this when Three.js objects (controllers/grips) are unreliable or out of sync.
     */
    public rawPoseToWorldPose(
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

}
