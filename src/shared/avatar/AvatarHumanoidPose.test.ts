import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createAvatarRestSkeletonPose } from './AvatarCanonicalRig';
import { createAvatarHumanoidPoseFromSkeleton } from './AvatarHumanoidPose';
import { buildNormalizedVrmPose } from '../../render/avatar/vrm/VrmPoseBuilder';
import { VRMHumanBoneName } from '@pixiv/three-vrm';

function quaternionAngle(quaternion: { x: number; y: number; z: number; w: number }): number {
    const q = new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w).normalize();
    return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

describe('AvatarHumanoidPose', () => {
    it('maps the canonical rest skeleton to an identity humanoid pose', () => {
        const humanoidPose = createAvatarHumanoidPoseFromSkeleton(createAvatarRestSkeletonPose());

        for (const joint of Object.values(humanoidPose.joints)) {
            if (!joint) continue;
            expect(quaternionAngle(joint.rotation)).toBeLessThan(1e-4);
        }

        expect(humanoidPose.joints.hips?.position).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('builds a zeroed VRM normalized pose for the canonical rest skeleton', () => {
        const humanoidPose = createAvatarHumanoidPoseFromSkeleton(createAvatarRestSkeletonPose());
        const vrmPose = buildNormalizedVrmPose(humanoidPose);

        for (const transform of Object.values(vrmPose)) {
            if (!transform?.rotation) continue;
            const [x, y, z, w] = transform.rotation;
            expect(quaternionAngle({ x, y, z, w })).toBeLessThan(1e-4);
        }

        expect(vrmPose[VRMHumanBoneName.Hips]?.position).toEqual([0, 0, 0]);
    });
});
