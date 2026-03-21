import * as THREE from 'three';
import {
    AVATAR_SKELETON_JOINTS,
    AvatarSkeletonJointName,
    createAvatarSkeletonPose,
    IAvatarSkeletonPose
} from './AvatarSkeleton';

const REST_POSITION_COMPONENTS: Record<AvatarSkeletonJointName, readonly [number, number, number]> = {
    hips: [0, 0.94, 0],
    spine: [0, 0.12, 0],
    chest: [0, 0.16, 0],
    upperChest: [0, 0.14, 0],
    neck: [0, 0.1, 0],
    head: [0, 0.12, 0],
    leftShoulder: [0.17, 0.04, 0],
    leftUpperArm: [0.02, 0, 0],
    leftLowerArm: [0.29, 0, 0],
    leftHand: [0.27, 0, 0],
    rightShoulder: [-0.17, 0.04, 0],
    rightUpperArm: [-0.02, 0, 0],
    rightLowerArm: [-0.29, 0, 0],
    rightHand: [-0.27, 0, 0],
    leftUpperLeg: [0.11, -0.02, 0],
    leftLowerLeg: [0, -0.46, 0],
    leftFoot: [0, -0.46, 0],
    leftToes: [0, 0, 0.11],
    rightUpperLeg: [-0.11, -0.02, 0],
    rightLowerLeg: [0, -0.46, 0],
    rightFoot: [0, -0.46, 0],
    rightToes: [0, 0, 0.11],
    leftThumbMetacarpal: [0.035, -0.01, 0.02],
    leftThumbProximal: [0.035, 0, 0.018],
    leftThumbDistal: [0.03, 0, 0.012],
    leftThumbTip: [0.024, 0, 0.008],
    leftIndexMetacarpal: [0.014, 0, 0.03],
    leftIndexProximal: [0.034, 0, 0.02],
    leftIndexIntermediate: [0.028, 0, 0],
    leftIndexDistal: [0.022, 0, 0],
    leftIndexTip: [0.018, 0, 0],
    leftMiddleMetacarpal: [0.004, 0, 0.01],
    leftMiddleProximal: [0.04, 0, 0.014],
    leftMiddleIntermediate: [0.03, 0, 0],
    leftMiddleDistal: [0.024, 0, 0],
    leftMiddleTip: [0.018, 0, 0],
    leftRingMetacarpal: [-0.008, 0, -0.008],
    leftRingProximal: [0.036, 0, 0.01],
    leftRingIntermediate: [0.028, 0, 0],
    leftRingDistal: [0.022, 0, 0],
    leftRingTip: [0.018, 0, 0],
    leftLittleMetacarpal: [-0.018, 0, -0.02],
    leftLittleProximal: [0.03, 0, 0.006],
    leftLittleIntermediate: [0.022, 0, 0],
    leftLittleDistal: [0.018, 0, 0],
    leftLittleTip: [0.014, 0, 0],
    rightThumbMetacarpal: [-0.035, -0.01, 0.02],
    rightThumbProximal: [-0.035, 0, 0.018],
    rightThumbDistal: [-0.03, 0, 0.012],
    rightThumbTip: [-0.024, 0, 0.008],
    rightIndexMetacarpal: [-0.014, 0, 0.03],
    rightIndexProximal: [-0.034, 0, 0.02],
    rightIndexIntermediate: [-0.028, 0, 0],
    rightIndexDistal: [-0.022, 0, 0],
    rightIndexTip: [-0.018, 0, 0],
    rightMiddleMetacarpal: [-0.004, 0, 0.01],
    rightMiddleProximal: [-0.04, 0, 0.014],
    rightMiddleIntermediate: [-0.03, 0, 0],
    rightMiddleDistal: [-0.024, 0, 0],
    rightMiddleTip: [-0.018, 0, 0],
    rightRingMetacarpal: [0.008, 0, -0.008],
    rightRingProximal: [-0.036, 0, 0.01],
    rightRingIntermediate: [-0.028, 0, 0],
    rightRingDistal: [-0.022, 0, 0],
    rightRingTip: [-0.018, 0, 0],
    rightLittleMetacarpal: [0.018, 0, -0.02],
    rightLittleProximal: [-0.03, 0, 0.006],
    rightLittleIntermediate: [-0.022, 0, 0],
    rightLittleDistal: [-0.018, 0, 0],
    rightLittleTip: [-0.014, 0, 0]
};

export const AVATAR_REST_LOCAL_POSITIONS: Record<AvatarSkeletonJointName, THREE.Vector3> = Object.fromEntries(
    AVATAR_SKELETON_JOINTS.map((jointName) => {
        const [x, y, z] = REST_POSITION_COMPONENTS[jointName];
        return [jointName, new THREE.Vector3(x, y, z)];
    })
) as Record<AvatarSkeletonJointName, THREE.Vector3>;

export function getAvatarRestLocalPosition(jointName: AvatarSkeletonJointName): THREE.Vector3 {
    return AVATAR_REST_LOCAL_POSITIONS[jointName].clone();
}

export function createAvatarRestSkeletonPose(): IAvatarSkeletonPose {
    const pose = createAvatarSkeletonPose();
    for (const jointName of AVATAR_SKELETON_JOINTS) {
        const restPosition = AVATAR_REST_LOCAL_POSITIONS[jointName];
        pose.joints[jointName]!.position = {
            x: restPosition.x,
            y: restPosition.y,
            z: restPosition.z
        };
    }
    return pose;
}

export function createAvatarVrmTPoseAtRoot(
    rootWorldPosition: { x: number; y: number; z: number },
    rootWorldQuaternion: { x: number; y: number; z: number; w: number }
): IAvatarSkeletonPose {
    const pose = createAvatarRestSkeletonPose();
    pose.rootWorldPosition = { ...rootWorldPosition };
    pose.rootWorldQuaternion = { ...rootWorldQuaternion };
    pose.poseState = 'standing';
    return pose;
}
