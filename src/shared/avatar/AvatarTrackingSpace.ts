import * as THREE from 'three';
import { IQuaternion, IVector3 } from '../contracts/IMath';

// WebXR/Three.js use -Z as the local forward basis. The canonical avatar rig
// follows VRM 1.0 semantics with +Z forward, so raw world-space orientations
// need a 180 degree Y-basis remap at the tracking boundary.
//
// This module currently owns orientation-space conversion only. Tracked world
// positions are still passed through in raw world coordinates.
const RAW_WORLD_TO_AVATAR_WORLD = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI
);

export function convertRawWorldQuaternionToAvatarWorldQuaternion(rawQuaternion: IQuaternion): IQuaternion {
    const quaternion = new THREE.Quaternion(
        rawQuaternion.x,
        rawQuaternion.y,
        rawQuaternion.z,
        rawQuaternion.w
    ).multiply(RAW_WORLD_TO_AVATAR_WORLD);

    return {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w
    };
}

export function convertAvatarWorldQuaternionToRawWorldQuaternion(avatarQuaternion: IQuaternion): IQuaternion {
    const quaternion = new THREE.Quaternion(
        avatarQuaternion.x,
        avatarQuaternion.y,
        avatarQuaternion.z,
        avatarQuaternion.w
    ).multiply(RAW_WORLD_TO_AVATAR_WORLD);

    return {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w
    };
}

export function convertRawWorldDirectionToAvatarWorldDirection(rawDirection: IVector3): IVector3 {
    const direction = new THREE.Vector3(
        rawDirection.x,
        rawDirection.y,
        rawDirection.z
    ).applyQuaternion(RAW_WORLD_TO_AVATAR_WORLD);

    return {
        x: direction.x,
        y: direction.y,
        z: direction.z
    };
}

export function resolveAvatarRootWorldPosition(
    trackingOriginWorldPosition: IVector3,
    headWorldPosition: IVector3,
    seated: boolean
): IVector3 {
    if (seated) {
        return { ...trackingOriginWorldPosition };
    }

    return {
        x: headWorldPosition.x,
        y: trackingOriginWorldPosition.y,
        z: headWorldPosition.z
    };
}
