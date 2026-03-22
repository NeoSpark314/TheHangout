import { describe, expect, it } from 'vitest';
import { AVATAR_REST_LOCAL_POSITIONS, createAvatarRestSkeletonPose } from './AvatarCanonicalRig';

describe('AvatarCanonicalRig', () => {
    it('defines a VRM-style T-pose rest rig facing +Z with left on -X', () => {
        expect(AVATAR_REST_LOCAL_POSITIONS.leftShoulder.x).toBeLessThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightShoulder.x).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftUpperArm.x).toBeLessThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightUpperArm.x).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftToes.z).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightToes.z).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftThumbProximal.x).toBeLessThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.leftThumbProximal.z).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightThumbProximal.x).toBeGreaterThan(0);
        expect(AVATAR_REST_LOCAL_POSITIONS.rightThumbProximal.z).toBeGreaterThan(0);
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
