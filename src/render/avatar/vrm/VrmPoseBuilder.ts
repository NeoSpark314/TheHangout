import { VRMHumanBoneName, type VRMPose } from '@pixiv/three-vrm';
import { AvatarHumanoidJointName, IAvatarHumanoidPose } from '../../../shared/avatar/AvatarHumanoidPose';

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

export function buildNormalizedVrmPose(humanoidPose: IAvatarHumanoidPose): VRMPose {
    const vrmPose: VRMPose = {};

    for (const [jointName, transform] of Object.entries(humanoidPose.joints) as Array<[AvatarHumanoidJointName, IAvatarHumanoidPose['joints'][AvatarHumanoidJointName]]>) {
        if (!transform) continue;

        const boneName = HUMANOID_TO_VRM_BONE[jointName];
        vrmPose[boneName] = {
            rotation: [
                transform.rotation.x,
                transform.rotation.y,
                transform.rotation.z,
                transform.rotation.w
            ]
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
