import * as THREE from 'three';
import { IPose, IQuaternion, IVector3 } from '../contracts/IMath';
import { QuatArr, Vec3Arr } from '../contracts/IEntityState';
import {
    AVATAR_SKELETON_JOINTS,
    AVATAR_SKELETON_PARENT,
    AvatarSkeletonJointName,
    IAvatarSkeletonPose
} from './AvatarSkeleton';

export interface IAvatarJointWorldPose {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
}

export type AvatarSkeletonWorldPoseMap = Partial<Record<AvatarSkeletonJointName, IAvatarJointWorldPose>>;

export const LEFT_HAND_FINGER_JOINTS: readonly AvatarSkeletonJointName[] = [
    'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip',
    'leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip',
    'leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip',
    'leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip',
    'leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip'
] as const;

export const RIGHT_HAND_FINGER_JOINTS: readonly AvatarSkeletonJointName[] = [
    'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightThumbTip',
    'rightIndexMetacarpal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightIndexTip',
    'rightMiddleMetacarpal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightMiddleTip',
    'rightRingMetacarpal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightRingTip',
    'rightLittleMetacarpal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightLittleTip'
] as const;

export function vectorToArray(vector: IVector3): Vec3Arr {
    return [vector.x, vector.y, vector.z];
}

export function quaternionToArray(quaternion: IQuaternion): QuatArr {
    return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

export function arrayToVector3(value: Vec3Arr | undefined, fallback: IVector3): IVector3 {
    if (!value) return { ...fallback };
    return { x: value[0], y: value[1], z: value[2] };
}

export function arrayToQuaternion(value: QuatArr | undefined, fallback: IQuaternion): IQuaternion {
    if (!value) return { ...fallback };
    return { x: value[0], y: value[1], z: value[2], w: value[3] };
}

export function copyThreeVector3(source: THREE.Vector3, target: IVector3): void {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
}

export function copyThreeQuaternion(source: THREE.Quaternion, target: IQuaternion): void {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
    target.w = source.w;
}

export function setPoseFromThree(pose: IPose, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    copyThreeVector3(position, pose.position);
    copyThreeQuaternion(quaternion, pose.quaternion);
}

export function poseToVector3(pose: Pick<IPose, 'position'>): THREE.Vector3 {
    return new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
}

export function poseToQuaternion(pose: Pick<IPose, 'quaternion'>): THREE.Quaternion {
    return new THREE.Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
}

export function composeAvatarWorldPoses(pose: IAvatarSkeletonPose): AvatarSkeletonWorldPoseMap {
    const world: AvatarSkeletonWorldPoseMap = {};
    const rootWorldPosition = new THREE.Vector3(
        pose.rootWorldPosition.x,
        pose.rootWorldPosition.y,
        pose.rootWorldPosition.z
    );
    const rootWorldQuaternion = new THREE.Quaternion(
        pose.rootWorldQuaternion.x,
        pose.rootWorldQuaternion.y,
        pose.rootWorldQuaternion.z,
        pose.rootWorldQuaternion.w
    );

    for (const jointName of AVATAR_SKELETON_JOINTS) {
        const localPose = pose.joints[jointName];
        if (!localPose) continue;

        const parentName = AVATAR_SKELETON_PARENT[jointName];
        const parentWorld = parentName ? world[parentName] : null;
        const parentPosition = parentWorld?.position || rootWorldPosition;
        const parentQuaternion = parentWorld?.quaternion || rootWorldQuaternion;

        const worldPosition = new THREE.Vector3(
            localPose.position.x,
            localPose.position.y,
            localPose.position.z
        ).applyQuaternion(parentQuaternion).add(parentPosition);
        const worldQuaternion = parentQuaternion.clone().multiply(new THREE.Quaternion(
            localPose.quaternion.x,
            localPose.quaternion.y,
            localPose.quaternion.z,
            localPose.quaternion.w
        ));

        world[jointName] = {
            position: worldPosition,
            quaternion: worldQuaternion
        };
    }

    return world;
}

export function getAvatarJointWorldPose(
    pose: IAvatarSkeletonPose,
    jointName: AvatarSkeletonJointName
): IAvatarJointWorldPose | null {
    const world = composeAvatarWorldPoses(pose);
    return world[jointName] || null;
}

export function getAvatarJointWorldPosition(
    pose: IAvatarSkeletonPose,
    jointName: AvatarSkeletonJointName
): THREE.Vector3 | null {
    const jointPose = getAvatarJointWorldPose(pose, jointName);
    return jointPose?.position || null;
}

