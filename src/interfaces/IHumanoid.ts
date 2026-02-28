import { IPose } from './IMath';

export type HumanoidJointName =
    | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'
    | 'leftShoulder' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
    | 'rightShoulder' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand'
    | 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot' | 'leftToes'
    | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot' | 'rightToes'
    | 'leftThumbMetacarpal' | 'leftThumbProximal' | 'leftThumbDistal' | 'leftThumbTip'
    | 'leftIndexMetacarpal' | 'leftIndexProximal' | 'leftIndexIntermediate' | 'leftIndexDistal' | 'leftIndexTip'
    | 'leftMiddleMetacarpal' | 'leftMiddleProximal' | 'leftMiddleIntermediate' | 'leftMiddleDistal' | 'leftMiddleTip'
    | 'leftRingMetacarpal' | 'leftRingProximal' | 'leftRingIntermediate' | 'leftRingDistal' | 'leftRingTip'
    | 'leftLittleMetacarpal' | 'leftLittleProximal' | 'leftLittleIntermediate' | 'leftLittleDistal' | 'leftLittleTip'
    | 'rightThumbMetacarpal' | 'rightThumbProximal' | 'rightThumbDistal' | 'rightThumbTip'
    | 'rightIndexMetacarpal' | 'rightIndexProximal' | 'rightIndexIntermediate' | 'rightIndexDistal' | 'rightIndexTip'
    | 'rightMiddleMetacarpal' | 'rightMiddleProximal' | 'rightMiddleIntermediate' | 'rightMiddleDistal' | 'rightMiddleTip'
    | 'rightRingMetacarpal' | 'rightRingProximal' | 'rightRingIntermediate' | 'rightRingDistal' | 'rightRingTip'
    | 'rightLittleMetacarpal' | 'rightLittleProximal' | 'rightLittleIntermediate' | 'rightLittleDistal' | 'rightLittleTip';

export interface IHumanoidState {
    // A map of the standard bone names to their current world or local pose
    joints: Partial<Record<HumanoidJointName, IPose>>;
}
