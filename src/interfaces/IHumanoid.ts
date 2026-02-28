import { IPose } from './IMath';

export type HumanoidJointName =
    | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'
    | 'leftShoulder' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
    | 'rightShoulder' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand'
    | 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot' | 'leftToes'
    | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot' | 'rightToes';

export interface IHumanoidState {
    // A map of the standard bone names to their current world or local pose
    joints: Partial<Record<HumanoidJointName, IPose>>;
}
