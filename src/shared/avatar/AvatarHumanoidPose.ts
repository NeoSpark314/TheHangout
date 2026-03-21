import { IQuaternion, IVector3 } from '../contracts/IMath';
import { AvatarSkeletonJointName, IAvatarSkeletonPose } from './AvatarSkeleton';
import { AVATAR_REST_LOCAL_POSITIONS } from './AvatarCanonicalRig';

export type AvatarHumanoidJointName =
    | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'
    | 'leftShoulder' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
    | 'rightShoulder' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand'
    | 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot' | 'leftToes'
    | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot' | 'rightToes'
    | 'leftThumbMetacarpal' | 'leftThumbProximal' | 'leftThumbDistal'
    | 'leftIndexProximal' | 'leftIndexIntermediate' | 'leftIndexDistal'
    | 'leftMiddleProximal' | 'leftMiddleIntermediate' | 'leftMiddleDistal'
    | 'leftRingProximal' | 'leftRingIntermediate' | 'leftRingDistal'
    | 'leftLittleProximal' | 'leftLittleIntermediate' | 'leftLittleDistal'
    | 'rightThumbMetacarpal' | 'rightThumbProximal' | 'rightThumbDistal'
    | 'rightIndexProximal' | 'rightIndexIntermediate' | 'rightIndexDistal'
    | 'rightMiddleProximal' | 'rightMiddleIntermediate' | 'rightMiddleDistal'
    | 'rightRingProximal' | 'rightRingIntermediate' | 'rightRingDistal'
    | 'rightLittleProximal' | 'rightLittleIntermediate' | 'rightLittleDistal';

export interface IAvatarHumanoidJointTransform {
    rotation: IQuaternion;
    position?: IVector3;
    tracked: boolean;
}

export interface IAvatarHumanoidPose {
    joints: Partial<Record<AvatarHumanoidJointName, IAvatarHumanoidJointTransform>>;
}

const SKELETON_TO_HUMANOID_MAP: Partial<Record<AvatarSkeletonJointName, AvatarHumanoidJointName>> = {
    hips: 'hips',
    spine: 'spine',
    chest: 'chest',
    upperChest: 'upperChest',
    neck: 'neck',
    head: 'head',
    leftShoulder: 'leftShoulder',
    leftUpperArm: 'leftUpperArm',
    leftLowerArm: 'leftLowerArm',
    leftHand: 'leftHand',
    rightShoulder: 'rightShoulder',
    rightUpperArm: 'rightUpperArm',
    rightLowerArm: 'rightLowerArm',
    rightHand: 'rightHand',
    leftUpperLeg: 'leftUpperLeg',
    leftLowerLeg: 'leftLowerLeg',
    leftFoot: 'leftFoot',
    leftToes: 'leftToes',
    rightUpperLeg: 'rightUpperLeg',
    rightLowerLeg: 'rightLowerLeg',
    rightFoot: 'rightFoot',
    rightToes: 'rightToes',
    leftThumbMetacarpal: 'leftThumbMetacarpal',
    leftThumbProximal: 'leftThumbProximal',
    leftThumbDistal: 'leftThumbDistal',
    leftIndexProximal: 'leftIndexProximal',
    leftIndexIntermediate: 'leftIndexIntermediate',
    leftIndexDistal: 'leftIndexDistal',
    leftMiddleProximal: 'leftMiddleProximal',
    leftMiddleIntermediate: 'leftMiddleIntermediate',
    leftMiddleDistal: 'leftMiddleDistal',
    leftRingProximal: 'leftRingProximal',
    leftRingIntermediate: 'leftRingIntermediate',
    leftRingDistal: 'leftRingDistal',
    leftLittleProximal: 'leftLittleProximal',
    leftLittleIntermediate: 'leftLittleIntermediate',
    leftLittleDistal: 'leftLittleDistal',
    rightThumbMetacarpal: 'rightThumbMetacarpal',
    rightThumbProximal: 'rightThumbProximal',
    rightThumbDistal: 'rightThumbDistal',
    rightIndexProximal: 'rightIndexProximal',
    rightIndexIntermediate: 'rightIndexIntermediate',
    rightIndexDistal: 'rightIndexDistal',
    rightMiddleProximal: 'rightMiddleProximal',
    rightMiddleIntermediate: 'rightMiddleIntermediate',
    rightMiddleDistal: 'rightMiddleDistal',
    rightRingProximal: 'rightRingProximal',
    rightRingIntermediate: 'rightRingIntermediate',
    rightRingDistal: 'rightRingDistal',
    rightLittleProximal: 'rightLittleProximal',
    rightLittleIntermediate: 'rightLittleIntermediate',
    rightLittleDistal: 'rightLittleDistal'
};

export function createAvatarHumanoidPoseFromSkeleton(skeleton: IAvatarSkeletonPose): IAvatarHumanoidPose {
    const joints: IAvatarHumanoidPose['joints'] = {};

    for (const [skeletonJointName, humanoidJointName] of Object.entries(SKELETON_TO_HUMANOID_MAP) as Array<[AvatarSkeletonJointName, AvatarHumanoidJointName]>) {
        const jointPose = skeleton.joints[skeletonJointName];
        if (!jointPose) continue;

        joints[humanoidJointName] = {
            rotation: { ...jointPose.quaternion },
            tracked: !!skeleton.tracked[skeletonJointName]
        };
    }

    const hips = skeleton.joints.hips;
    if (hips && joints.hips) {
        joints.hips.position = {
            x: hips.position.x - AVATAR_REST_LOCAL_POSITIONS.hips.x,
            y: hips.position.y - AVATAR_REST_LOCAL_POSITIONS.hips.y,
            z: hips.position.z - AVATAR_REST_LOCAL_POSITIONS.hips.z
        };
    }

    return { joints };
}
