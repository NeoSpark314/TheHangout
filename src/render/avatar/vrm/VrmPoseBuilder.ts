import { VRMHumanBoneName, type VRMPose } from '@pixiv/three-vrm';
import { AvatarHumanoidJointName, IAvatarHumanoidPose } from '../../../shared/avatar/AvatarHumanoidPose';
import * as THREE from 'three';

const HUMANOID_TO_VRM_BONE: Record<AvatarHumanoidJointName, VRMHumanBoneName> = {
    hips: VRMHumanBoneName.Hips,
    spine: VRMHumanBoneName.Spine,
    chest: VRMHumanBoneName.Chest,
    upperChest: VRMHumanBoneName.UpperChest,
    neck: VRMHumanBoneName.Neck,
    head: VRMHumanBoneName.Head,
    leftShoulder: VRMHumanBoneName.LeftShoulder,
    leftUpperArm: VRMHumanBoneName.LeftUpperArm,
    leftLowerArm: VRMHumanBoneName.LeftLowerArm,
    leftHand: VRMHumanBoneName.LeftHand,
    rightShoulder: VRMHumanBoneName.RightShoulder,
    rightUpperArm: VRMHumanBoneName.RightUpperArm,
    rightLowerArm: VRMHumanBoneName.RightLowerArm,
    rightHand: VRMHumanBoneName.RightHand,
    leftUpperLeg: VRMHumanBoneName.LeftUpperLeg,
    leftLowerLeg: VRMHumanBoneName.LeftLowerLeg,
    leftFoot: VRMHumanBoneName.LeftFoot,
    leftToes: VRMHumanBoneName.LeftToes,
    rightUpperLeg: VRMHumanBoneName.RightUpperLeg,
    rightLowerLeg: VRMHumanBoneName.RightLowerLeg,
    rightFoot: VRMHumanBoneName.RightFoot,
    rightToes: VRMHumanBoneName.RightToes,
    leftThumbMetacarpal: VRMHumanBoneName.LeftThumbMetacarpal,
    leftThumbProximal: VRMHumanBoneName.LeftThumbProximal,
    leftThumbDistal: VRMHumanBoneName.LeftThumbDistal,
    leftIndexProximal: VRMHumanBoneName.LeftIndexProximal,
    leftIndexIntermediate: VRMHumanBoneName.LeftIndexIntermediate,
    leftIndexDistal: VRMHumanBoneName.LeftIndexDistal,
    leftMiddleProximal: VRMHumanBoneName.LeftMiddleProximal,
    leftMiddleIntermediate: VRMHumanBoneName.LeftMiddleIntermediate,
    leftMiddleDistal: VRMHumanBoneName.LeftMiddleDistal,
    leftRingProximal: VRMHumanBoneName.LeftRingProximal,
    leftRingIntermediate: VRMHumanBoneName.LeftRingIntermediate,
    leftRingDistal: VRMHumanBoneName.LeftRingDistal,
    leftLittleProximal: VRMHumanBoneName.LeftLittleProximal,
    leftLittleIntermediate: VRMHumanBoneName.LeftLittleIntermediate,
    leftLittleDistal: VRMHumanBoneName.LeftLittleDistal,
    rightThumbMetacarpal: VRMHumanBoneName.RightThumbMetacarpal,
    rightThumbProximal: VRMHumanBoneName.RightThumbProximal,
    rightThumbDistal: VRMHumanBoneName.RightThumbDistal,
    rightIndexProximal: VRMHumanBoneName.RightIndexProximal,
    rightIndexIntermediate: VRMHumanBoneName.RightIndexIntermediate,
    rightIndexDistal: VRMHumanBoneName.RightIndexDistal,
    rightMiddleProximal: VRMHumanBoneName.RightMiddleProximal,
    rightMiddleIntermediate: VRMHumanBoneName.RightMiddleIntermediate,
    rightMiddleDistal: VRMHumanBoneName.RightMiddleDistal,
    rightRingProximal: VRMHumanBoneName.RightRingProximal,
    rightRingIntermediate: VRMHumanBoneName.RightRingIntermediate,
    rightRingDistal: VRMHumanBoneName.RightRingDistal,
    rightLittleProximal: VRMHumanBoneName.RightLittleProximal,
    rightLittleIntermediate: VRMHumanBoneName.RightLittleIntermediate,
    rightLittleDistal: VRMHumanBoneName.RightLittleDistal
};

const VRM0_HEAD_SPACE_CORRECTION = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI
);
const VRM0_LOCAL_SPACE_CORRECTION = VRM0_HEAD_SPACE_CORRECTION;
const VRM0_Y_FLIPPED_JOINTS = new Set<AvatarHumanoidJointName>([
    'head',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'leftThumbMetacarpal',
    'leftThumbProximal',
    'leftThumbDistal',
    'leftIndexProximal',
    'leftIndexIntermediate',
    'leftIndexDistal',
    'leftMiddleProximal',
    'leftMiddleIntermediate',
    'leftMiddleDistal',
    'leftRingProximal',
    'leftRingIntermediate',
    'leftRingDistal',
    'leftLittleProximal',
    'leftLittleIntermediate',
    'leftLittleDistal',
    'leftUpperLeg',
    'leftLowerLeg',
    'leftFoot',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
    'rightThumbMetacarpal',
    'rightThumbProximal',
    'rightThumbDistal',
    'rightIndexProximal',
    'rightIndexIntermediate',
    'rightIndexDistal',
    'rightMiddleProximal',
    'rightMiddleIntermediate',
    'rightMiddleDistal',
    'rightRingProximal',
    'rightRingIntermediate',
    'rightRingDistal',
    'rightLittleProximal',
    'rightLittleIntermediate',
    'rightLittleDistal',
    'rightUpperLeg',
    'rightLowerLeg',
    'rightFoot'
]);

function adaptRotationForVrmVersion(
    jointName: AvatarHumanoidJointName,
    rotation: { x: number; y: number; z: number; w: number },
    metaVersion: string | null | undefined
): [number, number, number, number] {
    if (metaVersion !== '0' || !VRM0_Y_FLIPPED_JOINTS.has(jointName)) {
        return [rotation.x, rotation.y, rotation.z, rotation.w];
    }

    // VRM 0 avatars are authored facing -Z. `rotateVRM0` fixes the model root,
    // but some normalized humanoid bone local spaces still behave as if their
    // semantic forward is inverted relative to our +Z-forward canonical rig.
    // Conjugating selected local rotations by a 180 degree Y rotation keeps
    // visible motion aligned for the affected VRM 0 head, arm, and leg chains.
    const correction = jointName === 'head'
        ? VRM0_HEAD_SPACE_CORRECTION
        : VRM0_LOCAL_SPACE_CORRECTION;
    const corrected = new THREE.Quaternion(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w
    ).premultiply(correction).multiply(correction);

    return [corrected.x, corrected.y, corrected.z, corrected.w];
}

export function buildNormalizedVrmPose(
    humanoidPose: IAvatarHumanoidPose,
    options: {
        metaVersion?: string | null;
    } = {}
): VRMPose {
    const vrmPose: VRMPose = {};
    const metaVersion = options.metaVersion ?? null;

    for (const [jointName, transform] of Object.entries(humanoidPose.joints) as Array<[AvatarHumanoidJointName, IAvatarHumanoidPose['joints'][AvatarHumanoidJointName]]>) {
        if (!transform) continue;

        const boneName = HUMANOID_TO_VRM_BONE[jointName];
        const rotation = adaptRotationForVrmVersion(jointName, transform.rotation, metaVersion);
        vrmPose[boneName] = {
            rotation
        };

        if (jointName === 'hips' && transform.position) {
            vrmPose[boneName]!.position = [
                transform.position.x,
                transform.position.y,
                transform.position.z
            ];
        }
    }

    return vrmPose;
}
