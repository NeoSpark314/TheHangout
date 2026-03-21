import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { convertRawWorldQuaternionToAvatarWorldQuaternion, resolveAvatarRootWorldPosition } from './AvatarTrackingSpace';

function toThreeQuaternion(quaternion: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
    return new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
}

describe('AvatarTrackingSpace', () => {
    it('maps raw engine forward (-Z) to avatar forward (+Z)', () => {
        const rawQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.65, 0.1, 'YXZ'));
        const avatarQuaternion = toThreeQuaternion(convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawQuaternion.x,
            y: rawQuaternion.y,
            z: rawQuaternion.z,
            w: rawQuaternion.w
        }));

        const rawForward = new THREE.Vector3(0, 0, -1).applyQuaternion(rawQuaternion);
        const avatarForward = new THREE.Vector3(0, 0, 1).applyQuaternion(avatarQuaternion);

        expect(avatarForward.distanceTo(rawForward)).toBeLessThan(1e-6);
    });

    it('projects standing avatar root translation onto the tracked head on the ground plane', () => {
        const root = resolveAvatarRootWorldPosition(
            { x: 1.2, y: 0.3, z: -0.8 },
            { x: 1.55, y: 1.7, z: -0.25 },
            false
        );

        expect(root).toEqual({ x: 1.55, y: 0.3, z: -0.25 });
    });

    it('keeps seated avatar root anchored to the tracking origin', () => {
        const root = resolveAvatarRootWorldPosition(
            { x: 1.2, y: 0.3, z: -0.8 },
            { x: 1.55, y: 1.1, z: -0.25 },
            true
        );

        expect(root).toEqual({ x: 1.2, y: 0.3, z: -0.8 });
    });
});
