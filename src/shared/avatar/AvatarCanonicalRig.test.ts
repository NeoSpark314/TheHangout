import { describe, expect, it } from 'vitest';
import { AVATAR_REST_LOCAL_POSITIONS, createAvatarRestSkeletonPose } from './AvatarCanonicalRig';

describe('AvatarCanonicalRig', () => {
    it('defines a VRM-style T-pose rest rig facing +Z with left on +X', () => {
        expect(AVATAR_REST_LOCAL_POSITIONS.leftShoulder.x).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightShoulder.x).toBeLessThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftUpperArm.x).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightUpperArm.x).toBeLessThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftToes.z).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightToes.z).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftThumbProximal.x).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftThumbProximal.z).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightThumbProximal.x).toBeLessThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightThumbProximal.z).toBeGreaterThan(0);
    });

    it('keeps the thumb shorter and more lateral than the index chain', () => {
        const leftThumbLength =
            AVATAR_REST_LOCAL_POSITIONS.leftThumbMetacarpal.length() +
            AVATAR_REST_LOCAL_POSITIONS.leftThumbProximal.length() +
            AVATAR_REST_LOCAL_POSITIONS.leftThumbDistal.length() +
            AVATAR_REST_LOCAL_POSITIONS.leftThumbTip.length();
        const leftIndexLength =
            AVATAR_REST_LOCAL_POSITIONS.leftIndexMetacarpal.length() +
            AVATAR_REST_LOCAL_POSITIONS.leftIndexProximal.length() +
            AVATAR_REST_LOCAL_POSITIONS.leftIndexIntermediate.length() +
            AVATAR_REST_LOCAL_POSITIONS.leftIndexDistal.length() +
            AVATAR_REST_LOCAL_POSITIONS.leftIndexTip.length();

        expect(leftThumbLength).toBeLessThan(leftIndexLength);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftThumbMetacarpal.z)
            .toBeGreaterThan(AVATAR_REST_LOCAL_POSITIONS.leftThumbMetacarpal.x);
    });

    it('creates an identity-rotation standing rest pose', () => {
        const pose = createAvatarRestSkeletonPose();

        expect(pose.poseState).toBe('standing');
        expect(pose.rootWorldQuaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
        expect(pose.joints.leftUpperArm?.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
        expect(pose.joints.rightUpperArm?.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
        expect(pose.joints.leftUpperLeg?.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
        expect(pose.joints.rightUpperLeg?.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    });
});
