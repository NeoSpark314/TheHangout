import { IQuaternion, IVector3 } from '../contracts/IMath';
import { AvatarSkeletonJointName, IAvatarSkeletonPose } from './AvatarSkeleton';

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

export const AVATAR_HUMANOID_JOINTS: readonly AvatarHumanoidJointName[] = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
    'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
    'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
    'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
    'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
    'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
    'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
    'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
    'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
    'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
    'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
] as const;

export interface IAvatarHumanoidJointTransform {
    rotation: IQuaternion;
    position?: IVector3;
    tracked: boolean;
}

export interface IAvatarHumanoidPose {
    joints: Partial<Record<AvatarHumanoidJointName, IAvatarHumanoidJointTransform>>;
}

const SKELETON_TO_HUMANOID: Partial<Record<AvatarSkeletonJointName, AvatarHumanoidJointName>> = {
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

    for (const [skeletonName, humanoidName] of Object.entries(SKELETON_TO_HUMANOID) as Array<[AvatarSkeletonJointName, AvatarHumanoidJointName]>) {
        const jointPose = skeleton.joints[skeletonName];
        if (!jointPose) continue;

        joints[humanoidName] = {
            rotation: {
                x: jointPose.quaternion.x,
                y: jointPose.quaternion.y,
                z: jointPose.quaternion.z,
                w: jointPose.quaternion.w
            },
            tracked: !!skeleton.tracked[skeletonName]
        };

        if (humanoidName === 'hips') {
            joints[humanoidName]!.position = {
                x: jointPose.position.x,
                y: jointPose.position.y,
                z: jointPose.position.z
            };
        }
    }

    return { joints };
}
