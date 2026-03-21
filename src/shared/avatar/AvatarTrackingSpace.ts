import * as THREE from 'three';
import { IQuaternion } from '../contracts/IMath';

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
