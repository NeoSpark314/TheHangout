import * as THREE from 'three';
import { IQuaternion, IVector3 } from '../contracts/IMath';
import { AvatarSkeletonJointName, IAvatarSkeletonPose } from './AvatarSkeleton';
import { composeAvatarWorldPoses } from './AvatarSkeletonUtils';

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

const HUMANOID_PARENT: Partial<Record<AvatarHumanoidJointName, AvatarHumanoidJointName | null>> = {
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
    leftIndexProximal: 'leftHand',
    leftIndexIntermediate: 'leftIndexProximal',
    leftIndexDistal: 'leftIndexIntermediate',
    leftMiddleProximal: 'leftHand',
    leftMiddleIntermediate: 'leftMiddleProximal',
    leftMiddleDistal: 'leftMiddleIntermediate',
    leftRingProximal: 'leftHand',
    leftRingIntermediate: 'leftRingProximal',
    leftRingDistal: 'leftRingIntermediate',
    leftLittleProximal: 'leftHand',
    leftLittleIntermediate: 'leftLittleProximal',
    leftLittleDistal: 'leftLittleIntermediate',
    rightThumbMetacarpal: 'rightHand',
    rightThumbProximal: 'rightThumbMetacarpal',
    rightThumbDistal: 'rightThumbProximal',
    rightIndexProximal: 'rightHand',
    rightIndexIntermediate: 'rightIndexProximal',
    rightIndexDistal: 'rightIndexIntermediate',
    rightMiddleProximal: 'rightHand',
    rightMiddleIntermediate: 'rightMiddleProximal',
    rightMiddleDistal: 'rightMiddleIntermediate',
    rightRingProximal: 'rightHand',
    rightRingIntermediate: 'rightRingProximal',
    rightRingDistal: 'rightRingIntermediate',
    rightLittleProximal: 'rightHand',
    rightLittleIntermediate: 'rightLittleProximal',
    rightLittleDistal: 'rightLittleIntermediate'
};

const REST_DIRECTION: Partial<Record<AvatarHumanoidJointName, THREE.Vector3>> = {
    spine: new THREE.Vector3(0, 1, 0),
    chest: new THREE.Vector3(0, 1, 0),
    upperChest: new THREE.Vector3(0, 1, 0),
    neck: new THREE.Vector3(0, 1, 0),
    leftShoulder: new THREE.Vector3(-1, 0, 0),
    leftUpperArm: new THREE.Vector3(-1, 0, 0),
    leftLowerArm: new THREE.Vector3(-1, 0, 0),
    rightShoulder: new THREE.Vector3(1, 0, 0),
    rightUpperArm: new THREE.Vector3(1, 0, 0),
    rightLowerArm: new THREE.Vector3(1, 0, 0),
    leftUpperLeg: new THREE.Vector3(0, -1, 0),
    leftLowerLeg: new THREE.Vector3(0, -1, 0),
    leftFoot: new THREE.Vector3(0, 0, 1),
    rightUpperLeg: new THREE.Vector3(0, -1, 0),
    rightLowerLeg: new THREE.Vector3(0, -1, 0),
    rightFoot: new THREE.Vector3(0, 0, 1),
    leftThumbMetacarpal: new THREE.Vector3(-0.89, 0.0, 0.45).normalize(),
    leftThumbProximal: new THREE.Vector3(-0.93, 0.0, 0.37).normalize(),
    leftThumbDistal: new THREE.Vector3(-0.93, 0.0, 0.37).normalize(),
    leftIndexProximal: new THREE.Vector3(-1, 0, 0),
    leftIndexIntermediate: new THREE.Vector3(-1, 0, 0),
    leftIndexDistal: new THREE.Vector3(-1, 0, 0),
    leftMiddleProximal: new THREE.Vector3(-1, 0, 0),
    leftMiddleIntermediate: new THREE.Vector3(-1, 0, 0),
    leftMiddleDistal: new THREE.Vector3(-1, 0, 0),
    leftRingProximal: new THREE.Vector3(-1, 0, 0),
    leftRingIntermediate: new THREE.Vector3(-1, 0, 0),
    leftRingDistal: new THREE.Vector3(-1, 0, 0),
    leftLittleProximal: new THREE.Vector3(-1, 0, 0),
    leftLittleIntermediate: new THREE.Vector3(-1, 0, 0),
    leftLittleDistal: new THREE.Vector3(-1, 0, 0),
    rightThumbMetacarpal: new THREE.Vector3(0.89, 0.0, 0.45).normalize(),
    rightThumbProximal: new THREE.Vector3(0.93, 0.0, 0.37).normalize(),
    rightThumbDistal: new THREE.Vector3(0.93, 0.0, 0.37).normalize(),
    rightIndexProximal: new THREE.Vector3(1, 0, 0),
    rightIndexIntermediate: new THREE.Vector3(1, 0, 0),
    rightIndexDistal: new THREE.Vector3(1, 0, 0),
    rightMiddleProximal: new THREE.Vector3(1, 0, 0),
    rightMiddleIntermediate: new THREE.Vector3(1, 0, 0),
    rightMiddleDistal: new THREE.Vector3(1, 0, 0),
    rightRingProximal: new THREE.Vector3(1, 0, 0),
    rightRingIntermediate: new THREE.Vector3(1, 0, 0),
    rightRingDistal: new THREE.Vector3(1, 0, 0),
    rightLittleProximal: new THREE.Vector3(1, 0, 0),
    rightLittleIntermediate: new THREE.Vector3(1, 0, 0),
    rightLittleDistal: new THREE.Vector3(1, 0, 0)
};

const SEGMENT_SOURCE: Array<{ joint: AvatarHumanoidJointName; child: AvatarSkeletonJointName }> = [
    { joint: 'spine', child: 'chest' },
    { joint: 'chest', child: 'upperChest' },
    { joint: 'upperChest', child: 'neck' },
    { joint: 'neck', child: 'head' },
    { joint: 'leftShoulder', child: 'leftUpperArm' },
    { joint: 'leftUpperArm', child: 'leftLowerArm' },
    { joint: 'leftLowerArm', child: 'leftHand' },
    { joint: 'rightShoulder', child: 'rightUpperArm' },
    { joint: 'rightUpperArm', child: 'rightLowerArm' },
    { joint: 'rightLowerArm', child: 'rightHand' },
    { joint: 'leftUpperLeg', child: 'leftLowerLeg' },
    { joint: 'leftLowerLeg', child: 'leftFoot' },
    { joint: 'leftFoot', child: 'leftToes' },
    { joint: 'rightUpperLeg', child: 'rightLowerLeg' },
    { joint: 'rightLowerLeg', child: 'rightFoot' },
    { joint: 'rightFoot', child: 'rightToes' },
    { joint: 'leftThumbMetacarpal', child: 'leftThumbProximal' },
    { joint: 'leftThumbProximal', child: 'leftThumbDistal' },
    { joint: 'leftThumbDistal', child: 'leftThumbTip' },
    { joint: 'leftIndexProximal', child: 'leftIndexIntermediate' },
    { joint: 'leftIndexIntermediate', child: 'leftIndexDistal' },
    { joint: 'leftIndexDistal', child: 'leftIndexTip' },
    { joint: 'leftMiddleProximal', child: 'leftMiddleIntermediate' },
    { joint: 'leftMiddleIntermediate', child: 'leftMiddleDistal' },
    { joint: 'leftMiddleDistal', child: 'leftMiddleTip' },
    { joint: 'leftRingProximal', child: 'leftRingIntermediate' },
    { joint: 'leftRingIntermediate', child: 'leftRingDistal' },
    { joint: 'leftRingDistal', child: 'leftRingTip' },
    { joint: 'leftLittleProximal', child: 'leftLittleIntermediate' },
    { joint: 'leftLittleIntermediate', child: 'leftLittleDistal' },
    { joint: 'leftLittleDistal', child: 'leftLittleTip' },
    { joint: 'rightThumbMetacarpal', child: 'rightThumbProximal' },
    { joint: 'rightThumbProximal', child: 'rightThumbDistal' },
    { joint: 'rightThumbDistal', child: 'rightThumbTip' },
    { joint: 'rightIndexProximal', child: 'rightIndexIntermediate' },
    { joint: 'rightIndexIntermediate', child: 'rightIndexDistal' },
    { joint: 'rightIndexDistal', child: 'rightIndexTip' },
    { joint: 'rightMiddleProximal', child: 'rightMiddleIntermediate' },
    { joint: 'rightMiddleIntermediate', child: 'rightMiddleDistal' },
    { joint: 'rightMiddleDistal', child: 'rightMiddleTip' },
    { joint: 'rightRingProximal', child: 'rightRingIntermediate' },
    { joint: 'rightRingIntermediate', child: 'rightRingDistal' },
    { joint: 'rightRingDistal', child: 'rightRingTip' },
    { joint: 'rightLittleProximal', child: 'rightLittleIntermediate' },
    { joint: 'rightLittleIntermediate', child: 'rightLittleDistal' },
    { joint: 'rightLittleDistal', child: 'rightLittleTip' }
];

const TMP_ROOT_QUAT = new THREE.Quaternion();
const TMP_PARENT_WORLD_QUAT = new THREE.Quaternion();
const TMP_PARENT_INV_QUAT = new THREE.Quaternion();
const TMP_WORLD_DIR = new THREE.Vector3();
const TMP_LOCAL_DIR = new THREE.Vector3();
const TMP_FORWARD = new THREE.Vector3();
const TMP_ACROSS = new THREE.Vector3();
const TMP_REST_FORWARD = new THREE.Vector3();
const TMP_REST_ACROSS = new THREE.Vector3();

export function createAvatarHumanoidPoseFromSkeleton(skeleton: IAvatarSkeletonPose): IAvatarHumanoidPose {
    const joints: IAvatarHumanoidPose['joints'] = {};
    const world = composeAvatarWorldPoses(skeleton);

    TMP_ROOT_QUAT.set(
        skeleton.rootWorldQuaternion.x,
        skeleton.rootWorldQuaternion.y,
        skeleton.rootWorldQuaternion.z,
        skeleton.rootWorldQuaternion.w
    );

    const hipsPose = skeleton.joints.hips;
    if (hipsPose) {
        joints.hips = {
            rotation: { ...hipsPose.quaternion },
            position: { ...hipsPose.position },
            tracked: !!skeleton.tracked.hips
        };
    }

    for (const segment of SEGMENT_SOURCE) {
        const rotation = buildSegmentRotation(skeleton, world, segment.joint, segment.child);
        if (!rotation) continue;
        joints[segment.joint] = {
            rotation,
            tracked: !!skeleton.tracked[segment.joint]
        };
    }

    const headPose = skeleton.joints.head;
    if (headPose) {
        joints.head = {
            rotation: { ...headPose.quaternion },
            tracked: !!skeleton.tracked.head
        };
    }

    applyHandFrame('left', skeleton, world, joints);
    applyHandFrame('right', skeleton, world, joints);

    const leftToesPose = skeleton.joints.leftToes;
    if (leftToesPose) {
        joints.leftToes = {
            rotation: { ...leftToesPose.quaternion },
            tracked: !!skeleton.tracked.leftToes
        };
    }

    const rightToesPose = skeleton.joints.rightToes;
    if (rightToesPose) {
        joints.rightToes = {
            rotation: { ...rightToesPose.quaternion },
            tracked: !!skeleton.tracked.rightToes
        };
    }

    return { joints };
}

function buildSegmentRotation(
    skeleton: IAvatarSkeletonPose,
    world: ReturnType<typeof composeAvatarWorldPoses>,
    jointName: AvatarHumanoidJointName,
    childName: AvatarSkeletonJointName
): IQuaternion | null {
    const jointWorld = world[jointName];
    const childWorld = world[childName];
    const restDirection = REST_DIRECTION[jointName];
    if (!jointWorld || !childWorld || !restDirection) return null;

    const parentWorldQuat = getParentWorldQuaternion(world, skeleton, jointName);
    TMP_PARENT_INV_QUAT.copy(parentWorldQuat).invert();

    TMP_WORLD_DIR.copy(childWorld.position).sub(jointWorld.position);
    if (TMP_WORLD_DIR.lengthSq() < 1e-6) {
        return null;
    }

    TMP_LOCAL_DIR.copy(TMP_WORLD_DIR).normalize().applyQuaternion(TMP_PARENT_INV_QUAT);
    const rotation = new THREE.Quaternion().setFromUnitVectors(restDirection, TMP_LOCAL_DIR.normalize());
    return quaternionToObject(rotation);
}

function applyHandFrame(
    side: 'left' | 'right',
    skeleton: IAvatarSkeletonPose,
    world: ReturnType<typeof composeAvatarWorldPoses>,
    joints: IAvatarHumanoidPose['joints']
): void {
    const handName = side === 'left' ? 'leftHand' : 'rightHand';
    const indexName = side === 'left' ? 'leftIndexProximal' : 'rightIndexProximal';
    const middleName = side === 'left' ? 'leftMiddleProximal' : 'rightMiddleProximal';
    const ringName = side === 'left' ? 'leftRingProximal' : 'rightRingProximal';
    const littleName = side === 'left' ? 'leftLittleProximal' : 'rightLittleProximal';

    const handWorld = world[handName];
    const indexWorld = world[indexName];
    const middleWorld = world[middleName];
    const ringWorld = world[ringName];
    const littleWorld = world[littleName];
    if (!handWorld || !indexWorld || !middleWorld || !ringWorld || !littleWorld) {
        const handPose = skeleton.joints[handName];
        if (handPose) {
            joints[handName] = {
                rotation: { ...handPose.quaternion },
                tracked: !!skeleton.tracked[handName]
            };
        }
        return;
    }

    const parentWorldQuat = getParentWorldQuaternion(world, skeleton, handName);
    TMP_PARENT_INV_QUAT.copy(parentWorldQuat).invert();

    TMP_FORWARD.copy(indexWorld.position).sub(handWorld.position)
        .add(middleWorld.position.clone().sub(handWorld.position))
        .add(ringWorld.position.clone().sub(handWorld.position))
        .multiplyScalar(1 / 3)
        .normalize()
        .applyQuaternion(TMP_PARENT_INV_QUAT);
    TMP_ACROSS.copy(littleWorld.position).sub(indexWorld.position).normalize().applyQuaternion(TMP_PARENT_INV_QUAT);

    TMP_REST_FORWARD.copy(side === 'left' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0));
    TMP_REST_ACROSS.copy(new THREE.Vector3(0, 0, -1));

    const rotation = rotationFromBasis(TMP_REST_FORWARD, TMP_REST_ACROSS, TMP_FORWARD, TMP_ACROSS);
    joints[handName] = {
        rotation: quaternionToObject(rotation),
        tracked: !!skeleton.tracked[handName]
    };
}

function getParentWorldQuaternion(
    world: ReturnType<typeof composeAvatarWorldPoses>,
    skeleton: IAvatarSkeletonPose,
    jointName: AvatarHumanoidJointName
): THREE.Quaternion {
    const parentName = HUMANOID_PARENT[jointName];
    if (!parentName) {
        return TMP_ROOT_QUAT;
    }

    return world[parentName]?.quaternion || TMP_ROOT_QUAT;
}

function rotationFromBasis(
    restForward: THREE.Vector3,
    restAcross: THREE.Vector3,
    desiredForward: THREE.Vector3,
    desiredAcross: THREE.Vector3
): THREE.Quaternion {
    const restBasis = makeBasis(restForward, restAcross);
    const desiredBasis = makeBasis(desiredForward, desiredAcross);
    return desiredBasis.multiply(restBasis.invert());
}

function makeBasis(forward: THREE.Vector3, across: THREE.Vector3): THREE.Quaternion {
    const xAxis = forward.clone().normalize();
    const zAxis = xAxis.clone().cross(across).normalize();
    const yAxis = zAxis.clone().cross(xAxis).normalize();
    const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function quaternionToObject(quaternion: THREE.Quaternion): IQuaternion {
    return {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w
    };
}
