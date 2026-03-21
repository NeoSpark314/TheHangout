import * as THREE from 'three';
import { HumanoidJointName } from '../../../shared/contracts/IHumanoid';
import type { IPlayerViewState } from '../stickfigure/StickFigureView';

export type AvatarHandSide = 'left' | 'right';

export const AVATAR_HAND_JOINTS: Record<AvatarHandSide, readonly HumanoidJointName[]> = {
    left: [
        'leftHand',
        'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip',
        'leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip',
        'leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip',
        'leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip',
        'leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip'
    ],
    right: [
        'rightHand',
        'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightThumbTip',
        'rightIndexMetacarpal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightIndexTip',
        'rightMiddleMetacarpal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightMiddleTip',
        'rightRingMetacarpal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightRingTip',
        'rightLittleMetacarpal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightLittleTip'
    ]
};

export interface IAvatarPoseDefaults {
    trackedTargets: Record<AvatarHandSide, THREE.Vector3>;
    restTargets: Record<AvatarHandSide, THREE.Vector3>;
}

export interface IAvatarSolvedJointPose {
    present: boolean;
    worldPosition: THREE.Vector3;
    localPosition: THREE.Vector3;
    worldQuaternion: THREE.Quaternion;
    localQuaternion: THREE.Quaternion;
}

export interface IAvatarSolvedHeadPose {
    present: boolean;
    worldQuaternion: THREE.Quaternion;
    localQuaternion: THREE.Quaternion;
}

export interface IAvatarSolvedHandPose {
    armTargetLocalPosition: THREE.Vector3;
    wrist: IAvatarSolvedJointPose;
    joints: Partial<Record<HumanoidJointName, IAvatarSolvedJointPose>>;
    hasFingerData: boolean;
}

export interface IAvatarSolvedPose {
    head: IAvatarSolvedHeadPose;
    hands: Record<AvatarHandSide, IAvatarSolvedHandPose>;
}

function createJointPose(): IAvatarSolvedJointPose {
    return {
        present: false,
        worldPosition: new THREE.Vector3(),
        localPosition: new THREE.Vector3(),
        worldQuaternion: new THREE.Quaternion(),
        localQuaternion: new THREE.Quaternion()
    };
}

function createHandPose(side: AvatarHandSide): IAvatarSolvedHandPose {
    const joints: Partial<Record<HumanoidJointName, IAvatarSolvedJointPose>> = {};
    for (const jointName of AVATAR_HAND_JOINTS[side]) {
        joints[jointName] = createJointPose();
    }

    return {
        armTargetLocalPosition: new THREE.Vector3(),
        wrist: joints[AVATAR_HAND_JOINTS[side][0]]!,
        joints,
        hasFingerData: false
    };
}

export class AvatarPoseSolver {
    private readonly solved: IAvatarSolvedPose = {
        head: {
            present: false,
            worldQuaternion: new THREE.Quaternion(),
            localQuaternion: new THREE.Quaternion()
        },
        hands: {
            left: createHandPose('left'),
            right: createHandPose('right')
        }
    };

    private readonly tmpWorldPos = new THREE.Vector3();
    private readonly tmpRootWorldQuat = new THREE.Quaternion();
    private readonly tmpInverseRootWorldQuat = new THREE.Quaternion();

    constructor(private readonly defaults: IAvatarPoseDefaults) { }

    public solve(root: THREE.Object3D, state: IPlayerViewState): IAvatarSolvedPose {
        root.updateMatrixWorld(true);
        root.getWorldQuaternion(this.tmpRootWorldQuat);
        this.tmpInverseRootWorldQuat.copy(this.tmpRootWorldQuat).invert();

        this.solveHead(state);
        this.solveHand(root, state, 'left');
        this.solveHand(root, state, 'right');

        return this.solved;
    }

    private solveHead(state: IPlayerViewState): void {
        if (!state.headQuaternion) {
            this.solved.head.present = false;
            this.solved.head.worldQuaternion.identity();
            this.solved.head.localQuaternion.identity();
            return;
        }

        this.solved.head.present = true;
        this.solved.head.worldQuaternion.set(
            state.headQuaternion.x,
            state.headQuaternion.y,
            state.headQuaternion.z,
            state.headQuaternion.w
        );
        this.solved.head.localQuaternion.copy(this.tmpInverseRootWorldQuat).multiply(this.solved.head.worldQuaternion);
    }

    private solveHand(root: THREE.Object3D, state: IPlayerViewState, side: AvatarHandSide): void {
        const solvedHand = this.solved.hands[side];
        const jointNames = AVATAR_HAND_JOINTS[side];
        const humanoidJoints = state.humanoid?.joints;
        const wristName = jointNames[0];
        const indexTipName = side === 'left' ? 'leftIndexTip' : 'rightIndexTip';
        const hasHumanoid = !!humanoidJoints;

        solvedHand.hasFingerData = !!humanoidJoints?.[indexTipName];

        for (let index = 0; index < jointNames.length; index += 1) {
            const jointName = jointNames[index];
            const jointPose = humanoidJoints?.[jointName];
            const shouldTrackJoint = jointName === wristName || solvedHand.hasFingerData;

            if (jointPose && shouldTrackJoint) {
                this.populateJointPose(root, solvedHand.joints[jointName]!, jointPose.position, jointPose.quaternion);
            } else {
                this.resetJointPose(solvedHand.joints[jointName]!);
            }
        }

        if (solvedHand.wrist.present) {
            solvedHand.armTargetLocalPosition.copy(solvedHand.wrist.localPosition);
        } else {
            solvedHand.armTargetLocalPosition.copy(
                hasHumanoid ? this.defaults.trackedTargets[side] : this.defaults.restTargets[side]
            );
        }
    }

    private populateJointPose(
        root: THREE.Object3D,
        solved: IAvatarSolvedJointPose,
        position: { x: number; y: number; z: number },
        quaternion: { x: number; y: number; z: number; w: number }
    ): void {
        solved.present = true;
        solved.worldPosition.set(position.x, position.y, position.z);
        solved.localPosition.copy(solved.worldPosition);
        root.worldToLocal(solved.localPosition);

        solved.worldQuaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        solved.localQuaternion.copy(this.tmpInverseRootWorldQuat).multiply(solved.worldQuaternion);
    }

    private resetJointPose(solved: IAvatarSolvedJointPose): void {
        solved.present = false;
        solved.worldPosition.set(0, 0, 0);
        solved.localPosition.set(0, 0, 0);
        solved.worldQuaternion.identity();
        solved.localQuaternion.identity();
    }
}
