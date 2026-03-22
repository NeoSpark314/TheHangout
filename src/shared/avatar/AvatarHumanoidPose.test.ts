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

    it('applies the VRM 0 head compatibility correction without changing rest pose', () => {
        const humanoidPose = createAvatarHumanoidPoseFromSkeleton(createAvatarRestSkeletonPose());
        const vrmPose = buildNormalizedVrmPose(humanoidPose, { metaVersion: '0' });

        const [x, y, z, w] = vrmPose[VRMHumanBoneName.Head]!.rotation!;
        expect(quaternionAngle({ x, y, z, w })).toBeLessThan(1e-4);
    });

    it('flips VRM 0 head pitch so visible face motion matches canonical look direction', () => {
        const pose = createAvatarRestSkeletonPose();
        const pitchUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0, 'YXZ'));
        pose.joints.head!.quaternion = { x: pitchUp.x, y: pitchUp.y, z: pitchUp.z, w: pitchUp.w };

        const humanoidPose = createAvatarHumanoidPoseFromSkeleton(pose);
        const vrmPose = buildNormalizedVrmPose(humanoidPose, { metaVersion: '0' });
        const [x, y, z, w] = vrmPose[VRMHumanBoneName.Head]!.rotation!;
        const corrected = new THREE.Quaternion(x, y, z, w);
        const semanticFaceForward = new THREE.Vector3(0, 0, -1).applyQuaternion(corrected);

        expect(semanticFaceForward.y).toBeGreaterThan(0);
    });

    it('applies the VRM 0 arm-chain compatibility correction to exported upper-arm rotations', () => {
        const pose = createAvatarRestSkeletonPose();
        const raiseArm = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -1.1, -0.35, 'YXZ'));
        pose.joints.leftUpperArm!.quaternion = { x: raiseArm.x, y: raiseArm.y, z: raiseArm.z, w: raiseArm.w };

        const humanoidPose = createAvatarHumanoidPoseFromSkeleton(pose);
        const uncorrected = buildNormalizedVrmPose(humanoidPose);
        const corrected = buildNormalizedVrmPose(humanoidPose, { metaVersion: '0' });
        const [ux, uy, uz, uw] = uncorrected[VRMHumanBoneName.LeftUpperArm]!.rotation!;
        const [cx, cy, cz, cw] = corrected[VRMHumanBoneName.LeftUpperArm]!.rotation!;
        const correction = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        const expected = new THREE.Quaternion(ux, uy, uz, uw)
            .premultiply(correction)
            .multiply(correction);

        expect(new THREE.Quaternion(cx, cy, cz, cw).angleTo(expected)).toBeLessThan(1e-6);
    });

    it('applies the VRM 0 leg-chain compatibility correction to exported upper-leg rotations', () => {
        const pose = createAvatarRestSkeletonPose();
        const raiseKnee = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0, 0.2, 'YXZ'));
        pose.joints.leftUpperLeg!.quaternion = { x: raiseKnee.x, y: raiseKnee.y, z: raiseKnee.z, w: raiseKnee.w };

        const humanoidPose = createAvatarHumanoidPoseFromSkeleton(pose);
        const uncorrected = buildNormalizedVrmPose(humanoidPose);
        const corrected = buildNormalizedVrmPose(humanoidPose, { metaVersion: '0' });
        const [ux, uy, uz, uw] = uncorrected[VRMHumanBoneName.LeftUpperLeg]!.rotation!;
        const [cx, cy, cz, cw] = corrected[VRMHumanBoneName.LeftUpperLeg]!.rotation!;
        const correction = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        const expected = new THREE.Quaternion(ux, uy, uz, uw)
            .premultiply(correction)
            .multiply(correction);

        expect(new THREE.Quaternion(cx, cy, cz, cw).angleTo(expected)).toBeLessThan(1e-6);
    });

    it('applies the VRM 0 foot compatibility correction to exported foot rotations', () => {
        const pose = createAvatarRestSkeletonPose();
        const flattenFoot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.05, 0.15, 'YXZ'));
        pose.joints.leftFoot!.quaternion = {
            x: flattenFoot.x,
            y: flattenFoot.y,
            z: flattenFoot.z,
            w: flattenFoot.w
        };

        const humanoidPose = createAvatarHumanoidPoseFromSkeleton(pose);
        const uncorrected = buildNormalizedVrmPose(humanoidPose);
        const corrected = buildNormalizedVrmPose(humanoidPose, { metaVersion: '0' });
        const [ux, uy, uz, uw] = uncorrected[VRMHumanBoneName.LeftFoot]!.rotation!;
        const [cx, cy, cz, cw] = corrected[VRMHumanBoneName.LeftFoot]!.rotation!;
        const correction = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        const expected = new THREE.Quaternion(ux, uy, uz, uw)
            .premultiply(correction)
            .multiply(correction);

        expect(new THREE.Quaternion(cx, cy, cz, cw).angleTo(expected)).toBeLessThan(1e-6);
    });

    it('applies the VRM 0 finger compatibility correction to exported finger rotations', () => {
        const pose = createAvatarRestSkeletonPose();
        const curlIndex = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55, 0.1, 0.08, 'YXZ'));
        pose.joints.leftIndexProximal!.quaternion = {
            x: curlIndex.x,
            y: curlIndex.y,
            z: curlIndex.z,
            w: curlIndex.w
        };

        const humanoidPose = createAvatarHumanoidPoseFromSkeleton(pose);
        const uncorrected = buildNormalizedVrmPose(humanoidPose);
        const corrected = buildNormalizedVrmPose(humanoidPose, { metaVersion: '0' });
        const [ux, uy, uz, uw] = uncorrected[VRMHumanBoneName.LeftIndexProximal]!.rotation!;
        const [cx, cy, cz, cw] = corrected[VRMHumanBoneName.LeftIndexProximal]!.rotation!;
        const correction = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
        const expected = new THREE.Quaternion(ux, uy, uz, uw)
            .premultiply(correction)
            .multiply(correction);

        expect(new THREE.Quaternion(cx, cy, cz, cw).angleTo(expected)).toBeLessThan(1e-6);
    });
});
