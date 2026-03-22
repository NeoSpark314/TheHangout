import { HumanoidJointName } from '../contracts/IHumanoid';
import { IPose, IQuaternion, IVector3 } from '../contracts/IMath';
import { QuatArr, Vec3Arr } from '../contracts/IEntityState';

export type AvatarSkeletonJointName = HumanoidJointName;
export type AvatarPoseState = 'standing' | 'seated';

export const AVATAR_SKELETON_JOINTS: AvatarSkeletonJointName[] = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
    'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip',
    'leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip',
    'leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip',
    'leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip',
    'leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip',
    'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightThumbTip',
    'rightIndexMetacarpal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightIndexTip',
    'rightMiddleMetacarpal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightMiddleTip',
    'rightRingMetacarpal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightRingTip',
    'rightLittleMetacarpal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightLittleTip'
];

export const AVATAR_SKELETON_PARENT: Record<AvatarSkeletonJointName, AvatarSkeletonJointName | null> = {
    hips: null,
    spine: 'hips',
    chest: 'spine',
    upperChest: 'chest',
    neck: 'upperChest',
    head: 'neck',
    leftShoulder: 'upperChest',
    leftUpperArm: 'leftShoulder',
    leftLowerArm: 'leftUpperArm',
    leftHand: 'leftLowerArm',
    rightShoulder: 'upperChest',
    rightUpperArm: 'rightShoulder',
    rightLowerArm: 'rightUpperArm',
    rightHand: 'rightLowerArm',
    leftUpperLeg: 'hips',
    leftLowerLeg: 'leftUpperLeg',
    leftFoot: 'leftLowerLeg',
    leftToes: 'leftFoot',
    rightUpperLeg: 'hips',
    rightLowerLeg: 'rightUpperLeg',
    rightFoot: 'rightLowerLeg',
    rightToes: 'rightFoot',
    leftThumbMetacarpal: 'leftHand',
    leftThumbProximal: 'leftThumbMetacarpal',
    leftThumbDistal: 'leftThumbProximal',
    leftThumbTip: 'leftThumbDistal',
    leftIndexMetacarpal: 'leftHand',
    leftIndexProximal: 'leftIndexMetacarpal',
    leftIndexIntermediate: 'leftIndexProximal',
    leftIndexDistal: 'leftIndexIntermediate',
    leftIndexTip: 'leftIndexDistal',
    leftMiddleMetacarpal: 'leftHand',
    leftMiddleProximal: 'leftMiddleMetacarpal',
    leftMiddleIntermediate: 'leftMiddleProximal',
    leftMiddleDistal: 'leftMiddleIntermediate',
    leftMiddleTip: 'leftMiddleDistal',
    leftRingMetacarpal: 'leftHand',
    leftRingProximal: 'leftRingMetacarpal',
    leftRingIntermediate: 'leftRingProximal',
    leftRingDistal: 'leftRingIntermediate',
    leftRingTip: 'leftRingDistal',
    leftLittleMetacarpal: 'leftHand',
    leftLittleProximal: 'leftLittleMetacarpal',
    leftLittleIntermediate: 'leftLittleProximal',
    leftLittleDistal: 'leftLittleIntermediate',
    leftLittleTip: 'leftLittleDistal',
    rightThumbMetacarpal: 'rightHand',
    rightThumbProximal: 'rightThumbMetacarpal',
    rightThumbDistal: 'rightThumbProximal',
    rightThumbTip: 'rightThumbDistal',
    rightIndexMetacarpal: 'rightHand',
    rightIndexProximal: 'rightIndexMetacarpal',
    rightIndexIntermediate: 'rightIndexProximal',
    rightIndexDistal: 'rightIndexIntermediate',
    rightIndexTip: 'rightIndexDistal',
    rightMiddleMetacarpal: 'rightHand',
    rightMiddleProximal: 'rightMiddleMetacarpal',
    rightMiddleIntermediate: 'rightMiddleProximal',
    rightMiddleDistal: 'rightMiddleIntermediate',
    rightMiddleTip: 'rightMiddleDistal',
    rightRingMetacarpal: 'rightHand',
    rightRingProximal: 'rightRingMetacarpal',
    rightRingIntermediate: 'rightRingProximal',
    rightRingDistal: 'rightRingIntermediate',
    rightRingTip: 'rightRingDistal',
    rightLittleMetacarpal: 'rightHand',
    rightLittleProximal: 'rightLittleMetacarpal',
    rightLittleIntermediate: 'rightLittleProximal',
    rightLittleDistal: 'rightLittleIntermediate',
    rightLittleTip: 'rightLittleDistal'
};

export interface IAvatarTrackingJoint {
    position: IVector3;
    quaternion: IQuaternion;
}

export interface IAvatarTrackingFrame {
    rootWorldPosition: IVector3;
    rootWorldQuaternion: IQuaternion;
    headWorldPose: IPose;
    effectors: Partial<Record<AvatarSkeletonJointName, IAvatarTrackingJoint>>;
    tracked: Partial<Record<AvatarSkeletonJointName, boolean>>;
    seated: boolean;
}

export type AvatarMotionMode = 'desktop' | 'xr-standing' | 'xr-seated';

export interface IAvatarMotionContext {
    mode: AvatarMotionMode;
    locomotionWorldVelocity: IVector3;
    explicitTurnDeltaYaw: number;
    seatWorldYaw?: number;
}

export interface IAvatarSkeletonPose {
    rootWorldPosition: IVector3;
    rootWorldQuaternion: IQuaternion;
    poseState: AvatarPoseState;
    joints: Partial<Record<AvatarSkeletonJointName, IPose>>;
    tracked: Partial<Record<AvatarSkeletonJointName, boolean>>;
}

export interface ISerializedAvatarJointPose {
    p?: Vec3Arr;
    q?: QuatArr;
    t?: 0 | 1;
}

export interface IAvatarSkeletonDelta {
    rp?: Vec3Arr;
    rq?: QuatArr;
    ps?: AvatarPoseState;
    j?: Record<string, ISerializedAvatarJointPose | null>;
}

export function createIdentityVector3(): IVector3 {
    return { x: 0, y: 0, z: 0 };
}

export function createIdentityQuaternion(): IQuaternion {
    return { x: 0, y: 0, z: 0, w: 1 };
}

export function createIdentityPose(): IPose {
    return {
        position: createIdentityVector3(),
        quaternion: createIdentityQuaternion()
    };
}

export function createAvatarSkeletonPose(): IAvatarSkeletonPose {
    const joints: Partial<Record<AvatarSkeletonJointName, IPose>> = {};
    for (const jointName of AVATAR_SKELETON_JOINTS) {
        joints[jointName] = createIdentityPose();
    }

    return {
        rootWorldPosition: createIdentityVector3(),
        rootWorldQuaternion: createIdentityQuaternion(),
        poseState: 'standing',
        joints,
        tracked: {}
    };
}

export function clonePose(pose: IPose): IPose {
    return {
        position: { ...pose.position },
        quaternion: { ...pose.quaternion }
    };
}

export function cloneAvatarSkeletonPose(pose: IAvatarSkeletonPose): IAvatarSkeletonPose {
    const joints: Partial<Record<AvatarSkeletonJointName, IPose>> = {};
    for (const jointName of AVATAR_SKELETON_JOINTS) {
        const jointPose = pose.joints[jointName];
        joints[jointName] = jointPose ? clonePose(jointPose) : createIdentityPose();
    }

    return {
        rootWorldPosition: { ...pose.rootWorldPosition },
        rootWorldQuaternion: { ...pose.rootWorldQuaternion },
        poseState: pose.poseState,
        joints,
        tracked: { ...pose.tracked }
    };
}
