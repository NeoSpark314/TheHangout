import * as THREE from 'three';
import { Vector3, Quaternion } from '../interfaces/IMath';
import { HandState } from '../entities/PlayerEntity';

/**
 * Handles Three.js specific XR coordinate transformations.
 */
export class XRSystem {
    private tempVec = new THREE.Vector3();
    private tempQuat = new THREE.Quaternion();
    private tempMatrix = new THREE.Matrix4();
    private avatarTransform = new THREE.Object3D();

    public updateHandPoses(
        xrFrame: XRFrame,
        referenceSpace: XRReferenceSpace,
        session: XRSession,
        outputHandPoses: { 
            left: { position: Vector3, quaternion: Quaternion, active: boolean }, 
            right: { position: Vector3, quaternion: Quaternion, active: boolean } 
        },
        outputJointStates: { left: HandState, right: HandState }
    ): void {
        outputHandPoses.left.active = false;
        outputHandPoses.right.active = false;
        outputJointStates.left.active = false;
        outputJointStates.right.active = false;

        for (const source of session.inputSources) {
            const handedness = source.handedness as 'left' | 'right';
            if (handedness !== 'left' && handedness !== 'right') continue;

            // Fallback: Grip space is for physical controllers, targetRaySpace for gaze/fallback
            const space = source.gripSpace || source.targetRaySpace;
            if (!space) continue;

            const pose = xrFrame.getPose(space, referenceSpace);
            if (pose) {
                const outPose = outputHandPoses[handedness];
                const outJoints = outputJointStates[handedness];
                
                outPose.active = true;
                outJoints.active = true;
                
                outPose.position = { x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z };
                outPose.quaternion = { x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w };

                if (source.hand) {
                    let i = 0;
                    for (const joint of source.hand.values()) {
                        if (i >= 25) break;
                        const jointPose = xrFrame.getJointPose(joint, referenceSpace);
                        if (jointPose) {
                            outJoints.joints[i].position = { x: jointPose.transform.position.x, y: jointPose.transform.position.y, z: jointPose.transform.position.z };
                            outJoints.joints[i].quaternion = { x: jointPose.transform.orientation.x, y: jointPose.transform.orientation.y, z: jointPose.transform.orientation.z, w: jointPose.transform.orientation.w };
                        }
                        i++;
                    }
                } else {
                    for (let i = 0; i < 25; i++) {
                        outJoints.joints[i].position = { x: 0, y: 0, z: 0 };
                    }
                }
            }
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

    public transformHandsToAvatarSpace(
        inputLeftHand: { position: Vector3, quaternion: Quaternion, active: boolean },
        inputRightHand: { position: Vector3, quaternion: Quaternion, active: boolean },
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

        const processHand = (input: { position: Vector3, quaternion: Quaternion, active: boolean }, state: HandState) => {
            state.active = input.active;
            if (!input.active) return;

            const worldPos = new THREE.Vector3(input.position.x, input.position.y, input.position.z).applyMatrix4(xrOriginMatrix);
            const worldQuat = new THREE.Quaternion(input.quaternion.x, input.quaternion.y, input.quaternion.z, input.quaternion.w).premultiply(xrOriginQuat);

            const localPos = this.avatarTransform.worldToLocal(worldPos.clone());
            const localQuat = worldQuat.clone().premultiply(this.avatarTransform.quaternion.clone().invert());

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

        processHand(inputLeftHand, handStates.left);
        processHand(inputRightHand, handStates.right);
    }
}
