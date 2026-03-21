import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AvatarMotionSolver } from './AvatarMotionSolver';
import { composeAvatarWorldPoses } from './AvatarSkeletonUtils';
import { AvatarSkeletonJointName, IAvatarMotionContext, IAvatarTrackingFrame } from './AvatarSkeleton';
import { AVATAR_REST_LOCAL_POSITIONS } from './AvatarCanonicalRig';

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

function createMotionContext(mode: IAvatarMotionContext['mode'] = 'desktop'): IAvatarMotionContext {
    return {
        mode,
        locomotionWorldVelocity: { x: 0, y: 0, z: 0 },
        explicitTurnDeltaYaw: 0
    };
}

function expectChildAxisAlignment(
    pose: ReturnType<AvatarMotionSolver['solve']>,
    jointName: AvatarSkeletonJointName,
    childName: AvatarSkeletonJointName
): void {
    const world = composeAvatarWorldPoses(pose);
    const joint = world[jointName]!;
    const child = world[childName]!;
    const actualDirection = child.position.clone().sub(joint.position).normalize();
    const expectedDirection = AVATAR_REST_LOCAL_POSITIONS[childName]
        .clone()
        .normalize()
        .applyQuaternion(joint.quaternion);

    expect(actualDirection.distanceTo(expectedDirection)).toBeLessThan(1e-4);
}

describe('AvatarMotionSolver', () => {
    it('keeps canonical head and hand world targets aligned to tracking anchors', () => {
        const solver = new AvatarMotionSolver();
        let pose = solver.solve(createTrackingFrame(false), createMotionContext('desktop'), 0, 1 / 60);
        for (let i = 0; i < 8; i += 1) {
            pose = solver.solve(createTrackingFrame(false), createMotionContext('desktop'), 0, 1 / 60);
        }
        const world = composeAvatarWorldPoses(pose);

        expect(world.head?.position.distanceTo(new THREE.Vector3(0.02, 1.68, 0.05))).toBeLessThan(0.002);
        expect(world.leftHand?.position.distanceTo(new THREE.Vector3(-0.42, 1.18, 0.22))).toBeLessThan(0.12);
        expect(world.rightHand?.position.distanceTo(new THREE.Vector3(0.38, 1.15, 0.18))).toBeLessThan(0.12);
        expect(pose.tracked.leftIndexTip).toBe(true);
        expect(pose.tracked.rightIndexTip).toBe(true);
    });

    it('switches into seated pose with lowered hips and forward feet targets', () => {
        const solver = new AvatarMotionSolver();
        const pose = solver.solve(createTrackingFrame(true), createMotionContext('xr-seated'), 0, 1 / 60);
        const world = composeAvatarWorldPoses(pose);

        expect(pose.poseState).toBe('seated');
        expect(pose.joints.hips?.position.y).toBeLessThan(0.8);
        expect(world.leftFoot?.position.z).toBeGreaterThan(0.15);
        expect(world.rightFoot?.position.z).toBeGreaterThan(0.15);
    });

    it('preserves tracked head yaw by distributing torso twist below the head', () => {
        const solver = new AvatarMotionSolver();
        const headYaw = THREE.MathUtils.degToRad(70);
        const headQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, headYaw, 0, 'YXZ'));
        const frame = createTrackingFrame(false);
        frame.headWorldPose.quaternion = { x: headQuat.x, y: headQuat.y, z: headQuat.z, w: headQuat.w };

        const pose = solver.solve(frame, createMotionContext('xr-standing'), 0, 1 / 60);
        const world = composeAvatarWorldPoses(pose);
        const solvedHeadYaw = new THREE.Euler().setFromQuaternion(world.head!.quaternion, 'YXZ').y;
        const chestYaw = new THREE.Euler().setFromQuaternion(world.chest!.quaternion, 'YXZ').y;
        const neckYaw = new THREE.Euler().setFromQuaternion(world.neck!.quaternion, 'YXZ').y;

        expect(solvedHeadYaw).toBeCloseTo(headYaw, 2);
        expect(Math.abs(chestYaw)).toBeGreaterThan(0.1);
        expect(Math.abs(neckYaw)).toBeGreaterThan(Math.abs(chestYaw));
    });

    it('preserves tracked head pitch direction in canonical space', () => {
        const solver = new AvatarMotionSolver();
        const headPitch = -0.3;
        const headQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(headPitch, 0, 0, 'YXZ'));
        const frame = createTrackingFrame(false);
        frame.headWorldPose.quaternion = { x: headQuat.x, y: headQuat.y, z: headQuat.z, w: headQuat.w };

        const pose = solver.solve(frame, createMotionContext('desktop'), 0, 1 / 60);
        const world = composeAvatarWorldPoses(pose);
        const headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(world.head!.quaternion);

        expect(headForward.y).toBeGreaterThan(0);
    });

    it('keeps solved limb rotations aligned with canonical child axes', () => {
        const solver = new AvatarMotionSolver();
        let pose = solver.solve(createTrackingFrame(false), createMotionContext('desktop'), 0, 1 / 60);
        for (let i = 0; i < 8; i += 1) {
            pose = solver.solve(createTrackingFrame(false), createMotionContext('desktop'), 0, 1 / 60);
        }

        expectChildAxisAlignment(pose, 'leftUpperArm', 'leftLowerArm');
        expectChildAxisAlignment(pose, 'rightUpperArm', 'rightLowerArm');
        expectChildAxisAlignment(pose, 'leftUpperLeg', 'leftLowerLeg');
        expectChildAxisAlignment(pose, 'rightUpperLeg', 'rightLowerLeg');
    });

    it('does not use controller-style wrist orientation as a direct hand-bone rotation without tracked fingers', () => {
        const solver = new AvatarMotionSolver();
        const frame = createTrackingFrame(false);
        const flippedHandQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ'));
        frame.effectors.leftHand!.quaternion = {
            x: flippedHandQuat.x,
            y: flippedHandQuat.y,
            z: flippedHandQuat.z,
            w: flippedHandQuat.w
        };
        delete frame.tracked.leftIndexTip;

        const pose = solver.solve(frame, createMotionContext('xr-standing'), 0, 1 / 60);

        expect(pose.joints.leftHand?.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    });
});
