import * as THREE from 'three';
import { Vector3, Quaternion } from '../interfaces/IMath';
import { HandState } from '../entities/PlayerEntity';
import { RenderManager } from '../managers/RenderManager';

/**
 * Architectural Role: Centralized math hub for XR coordinate transformations.
 * Note: Uses THREE.js classes (Vector3, Matrix4) strictly for spatial math. 
 * This system should remain decoupled from THREE.js scene objects (Meshes, Groups).
 */
export class XRSystem {
    private tempVec = new THREE.Vector3();
    private tempQuat = new THREE.Quaternion();
    private tempMatrix = new THREE.Matrix4();
    private avatarTransform = new THREE.Object3D();

    public updateHandPosesFromControllers(
        render: RenderManager,
        leftHandPose: { position: Vector3, quaternion: Quaternion },
        rightHandPose: { position: Vector3, quaternion: Quaternion },
        handStates: { left: HandState, right: HandState },
        leftControllerIndex: number,
        rightControllerIndex: number
    ): void {
        const process = (pose: { position: Vector3, quaternion: Quaternion }, state: HandState, index: number) => {
            if (!state.active) return;
            const controller = render.getXRController(index);
            controller.getWorldPosition(this.tempVec);
            controller.getWorldQuaternion(this.tempQuat);
            
            pose.position = { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z };
            pose.quaternion = { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w };

            // CRITICAL: We MUST set the state position to world space so transformHandsToAvatarSpace
            // can transform it to local space. Otherwise, it will use the previous frame's local
            // position as a world position, leading to "infinity" feedback loops.
            state.position = { ...pose.position };
            state.quaternion = { ...pose.quaternion };
        };

        process(leftHandPose, handStates.left, leftControllerIndex);
        process(rightHandPose, handStates.right, rightControllerIndex);
    }

    public updateJointsFromXRFrame(
        xrFrame: XRFrame,
        referenceSpace: XRReferenceSpace,
        session: XRSession,
        handStates: { left: HandState, right: HandState }
    ): void {
        // Reset joint activity flags
        const hasHand = { left: false, right: false };

        for (const source of session.inputSources) {
            const handedness = source.handedness as 'left' | 'right';
            if (handedness !== 'left' && handedness !== 'right') continue;
            
            const state = handStates[handedness];
            if (source.hand && state.active && xrFrame.getJointPose) {
                hasHand[handedness] = true;
                let i = 0;
                for (const joint of source.hand.values()) {
                    if (i >= 25) break;
                    const jointPose = xrFrame.getJointPose(joint, referenceSpace);
                    if (jointPose) {
                        state.joints[i].position = { x: jointPose.transform.position.x, y: jointPose.transform.position.y, z: jointPose.transform.position.z };
                        state.joints[i].quaternion = { x: jointPose.transform.orientation.x, y: jointPose.transform.orientation.y, z: jointPose.transform.orientation.z, w: jointPose.transform.orientation.w };
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

    public getCameraWorldPose(camera: THREE.Camera): { position: Vector3, quaternion: Quaternion, yaw: number } {
        camera.getWorldPosition(this.tempVec);
        camera.getWorldQuaternion(this.tempQuat);
        const euler = new THREE.Euler().setFromQuaternion(this.tempQuat, 'YXZ');
        
        return {
            position: { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z },
            quaternion: { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w },
            yaw: euler.y
        };
    }

    public getControllerWorldPose(render: RenderManager, index: number): { position: Vector3, quaternion: Quaternion } {
        const controller = render.getXRController(index);
        controller.getWorldPosition(this.tempVec);
        controller.getWorldQuaternion(this.tempQuat);

        return {
            position: { x: this.tempVec.x, y: this.tempVec.y, z: this.tempVec.z },
            quaternion: { x: this.tempQuat.x, y: this.tempQuat.y, z: this.tempQuat.z, w: this.tempQuat.w }
        };
    }

    public transformHandsToAvatarSpace(
        xrOrigin: { position: Vector3, quaternion: Quaternion },
        bodyYaw: number,
        headWorldPos: Vector3,
        handStates: { left: HandState, right: HandState }
    ): void {
        this.avatarTransform.position.set(headWorldPos.x, 0, headWorldPos.z);
        this.avatarTransform.rotation.y = bodyYaw;
        this.avatarTransform.updateMatrixWorld(true);

        const xrOriginQuat = new THREE.Quaternion(xrOrigin.quaternion.x, xrOrigin.quaternion.y, xrOrigin.quaternion.z, xrOrigin.quaternion.w);
        const xrOriginMatrix = this.tempMatrix.makeRotationFromQuaternion(xrOriginQuat)
            .setPosition(xrOrigin.position.x, xrOrigin.position.y, xrOrigin.position.z);

        const processHand = (state: HandState) => {
            if (!state.active) return;

            // Poses are already in world space from updateHandPosesFromControllers
            this.tempVec.set(state.position.x, state.position.y, state.position.z);
            this.tempQuat.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);

            const localPos = this.avatarTransform.worldToLocal(this.tempVec.clone());
            const localQuat = this.tempQuat.clone().premultiply(this.avatarTransform.quaternion.clone().invert());

            state.position = { x: localPos.x, y: localPos.y, z: localPos.z };
            state.quaternion = { x: localQuat.x, y: localQuat.y, z: localQuat.z, w: localQuat.w };

            for (let i = 0; i < 25; i++) {
                const j = state.joints[i];
                if (j.position.x !== 0 || j.position.y !== 0 || j.position.z !== 0) {
                    const jWorldPos = new THREE.Vector3(j.position.x, j.position.y, j.position.z).applyMatrix4(xrOriginMatrix);
                    const jWorldQuat = new THREE.Quaternion(j.quaternion.x, j.quaternion.y, j.quaternion.z, j.quaternion.w).premultiply(xrOriginQuat);
                    const jLocalPos = this.avatarTransform.worldToLocal(jWorldPos);
                    const jLocalQuat = jWorldQuat.premultiply(this.avatarTransform.quaternion.clone().invert());
                    j.position = { x: jLocalPos.x, y: jLocalPos.y, z: jLocalPos.z };
                    j.quaternion = { x: jLocalQuat.x, y: jLocalQuat.y, z: jLocalQuat.z, w: jLocalQuat.w };
                }
            }
        };

        processHand(handStates.left);
        processHand(handStates.right);
    }
}
