import { describe, expect, it } from 'vitest';
import { AvatarSkeletonState } from './AvatarSkeletonState';
import { createAvatarSkeletonPose } from './AvatarSkeleton';

describe('AvatarSkeletonState', () => {
    it('serializes and reapplies a canonical skeleton delta', () => {
        const pose = createAvatarSkeletonPose();
        pose.rootWorldPosition = { x: 1, y: 0, z: -2 };
        pose.rootWorldQuaternion = { x: 0, y: 0.7071068, z: 0, w: 0.7071068 };
        pose.poseState = 'seated';
        pose.joints.hips!.position = { x: 0.05, y: 0.62, z: 0.08 };
        pose.joints.head!.position = { x: 0, y: 0.18, z: 0.02 };
        pose.tracked.head = true;
        pose.tracked.leftHand = true;

        const source = new AvatarSkeletonState();
        source.setPose(pose);
        const delta = source.consumeNetworkDelta(true);

        expect(delta?.rp).toEqual([1, 0, -2]);
        expect(delta?.ps).toBe('seated');
        expect(delta?.j?.hips?.t).toBe(0);
        expect(delta?.j?.head?.t).toBe(1);

        const target = new AvatarSkeletonState();
        target.applyNetworkDelta(delta);

        expect(target.pose.rootWorldPosition).toEqual(pose.rootWorldPosition);
        expect(target.pose.poseState).toBe('seated');
        expect(target.pose.joints.hips?.position).toEqual(pose.joints.hips?.position);
        expect(target.pose.tracked.head).toBe(true);
        expect(target.pose.tracked.leftHand).toBe(true);
    });
});
