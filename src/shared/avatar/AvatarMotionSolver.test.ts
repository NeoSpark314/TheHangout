import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AvatarMotionSolver } from './AvatarMotionSolver';
import { composeAvatarWorldPoses } from './AvatarSkeletonUtils';
import { IAvatarTrackingFrame } from './AvatarSkeleton';

function createTrackingFrame(seated = false): IAvatarTrackingFrame {
    const headQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.1, 0, 'YXZ'));
    return {
        rootWorldPosition: { x: 0, y: 0, z: 0 },
        rootWorldQuaternion: { x: 0, y: 0, z: 0, w: 1 },
        headWorldPose: {
            position: { x: 0.02, y: 1.68, z: 0.05 },
            quaternion: { x: headQuat.x, y: headQuat.y, z: headQuat.z, w: headQuat.w }
        },
        effectors: {
            leftHand: {
                position: { x: -0.42, y: 1.18, z: 0.22 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            },
            rightHand: {
                position: { x: 0.38, y: 1.15, z: 0.18 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            },
            leftIndexTip: {
                position: { x: -0.5, y: 1.2, z: 0.28 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            },
            rightIndexTip: {
                position: { x: 0.46, y: 1.18, z: 0.25 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            }
        },
        tracked: {
            head: true,
            leftHand: true,
            rightHand: true,
            leftIndexTip: true,
            rightIndexTip: true
        },
        seated
    };
}

describe('AvatarMotionSolver', () => {
    it('keeps canonical head and hand world targets aligned to tracking anchors', () => {
        const solver = new AvatarMotionSolver();
        let pose = solver.solve(createTrackingFrame(false), 1 / 60);
        for (let i = 0; i < 8; i += 1) {
            pose = solver.solve(createTrackingFrame(false), 1 / 60);
        }
        const world = composeAvatarWorldPoses(pose);

        expect(world.head?.position.distanceTo(new THREE.Vector3(0.02, 1.68, 0.05))).toBeLessThan(0.001);
        expect(world.leftHand?.position.distanceTo(new THREE.Vector3(-0.42, 1.18, 0.22))).toBeLessThan(0.12);
        expect(world.rightHand?.position.distanceTo(new THREE.Vector3(0.38, 1.15, 0.18))).toBeLessThan(0.12);
        expect(pose.tracked.leftIndexTip).toBe(true);
        expect(pose.tracked.rightIndexTip).toBe(true);
    });

    it('switches into seated pose with lowered hips and forward feet targets', () => {
        const solver = new AvatarMotionSolver();
        const pose = solver.solve(createTrackingFrame(true), 1 / 60);
        const world = composeAvatarWorldPoses(pose);

        expect(pose.poseState).toBe('seated');
        expect(pose.joints.hips?.position.y).toBeLessThan(0.8);
        expect(world.leftFoot?.position.z).toBeGreaterThan(0.15);
        expect(world.rightFoot?.position.z).toBeGreaterThan(0.15);
    });
});
