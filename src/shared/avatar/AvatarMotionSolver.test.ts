import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AvatarMotionSolver } from './AvatarMotionSolver';
import { composeAvatarWorldPoses } from './AvatarSkeletonUtils';
import { AvatarSkeletonJointName, IAvatarMotionContext, IAvatarTrackingFrame } from './AvatarSkeleton';
import { AVATAR_REST_LOCAL_POSITIONS } from './AvatarCanonicalRig';
import { convertRawWorldQuaternionToAvatarWorldQuaternion } from './AvatarTrackingSpace';

const LEFT_TRACKED_HAND_CHAINS: ReadonlyArray<readonly AvatarSkeletonJointName[]> = [
    ['leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip'],
    ['leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip'],
    ['leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip'],
    ['leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip'],
    ['leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip']
] as const;
const RIGHT_TRACKED_HAND_CHAINS: ReadonlyArray<readonly AvatarSkeletonJointName[]> = [
    ['rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightThumbTip'],
    ['rightIndexMetacarpal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightIndexTip'],
    ['rightMiddleMetacarpal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightMiddleTip'],
    ['rightRingMetacarpal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightRingTip'],
    ['rightLittleMetacarpal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightLittleTip']
] as const;

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

function createHandWorldQuaternion(backOfHand: THREE.Vector3, thumbSide: THREE.Vector3): THREE.Quaternion {
    const yAxis = backOfHand.clone().normalize();
    const zAxis = thumbSide.clone()
        .sub(yAxis.clone().multiplyScalar(thumbSide.dot(yAxis)))
        .normalize();
    const xAxis = yAxis.clone().cross(zAxis).normalize();
    const fixedZ = xAxis.clone().cross(yAxis).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, fixedZ));
}

function createGripToHandOffset(side: 'left' | 'right'): THREE.Quaternion {
    const rawGripOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const backOfHand = new THREE.Vector3(side === 'left' ? -1 : 1, 0, 0).applyQuaternion(rawGripOffset);
    const thumbSide = new THREE.Vector3(0, 0, -1).applyQuaternion(rawGripOffset);
    return createHandWorldQuaternion(backOfHand, thumbSide);
}

function setTrackedHandPose(
    frame: IAvatarTrackingFrame,
    side: 'left' | 'right',
    handWorldPosition: THREE.Vector3,
    handWorldQuaternion: THREE.Quaternion
): void {
    const handName = side === 'left' ? 'leftHand' : 'rightHand';
    const chains = side === 'left' ? LEFT_TRACKED_HAND_CHAINS : RIGHT_TRACKED_HAND_CHAINS;
    const bogusQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 3, -Math.PI / 4, Math.PI / 5, 'YXZ'));

    frame.effectors[handName] = {
        position: { x: handWorldPosition.x, y: handWorldPosition.y, z: handWorldPosition.z },
        quaternion: { x: bogusQuaternion.x, y: bogusQuaternion.y, z: bogusQuaternion.z, w: bogusQuaternion.w }
    };
    frame.tracked[handName] = true;

    for (const chain of chains) {
        let parentWorldPosition = handWorldPosition.clone();
        let parentWorldQuaternion = handWorldQuaternion.clone();

        for (const jointName of chain) {
            const localPosition = AVATAR_REST_LOCAL_POSITIONS[jointName];
            const worldPosition = localPosition.clone().applyQuaternion(parentWorldQuaternion).add(parentWorldPosition);
            frame.effectors[jointName] = {
                position: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
                quaternion: { x: bogusQuaternion.x, y: bogusQuaternion.y, z: bogusQuaternion.z, w: bogusQuaternion.w }
            };
            frame.tracked[jointName] = true;
            parentWorldPosition = worldPosition;
        }
    }
}

function clearTrackedFingerSkeleton(frame: IAvatarTrackingFrame, side: 'left' | 'right'): void {
    const chains = side === 'left' ? LEFT_TRACKED_HAND_CHAINS : RIGHT_TRACKED_HAND_CHAINS;
    for (const chain of chains) {
        for (const jointName of chain) {
            delete frame.effectors[jointName];
            delete frame.tracked[jointName];
        }
    }
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

    it('derives tracked hand pose from joint positions instead of raw XR joint quaternions', () => {
        const solver = new AvatarMotionSolver();
        const seedPose = solver.solve(createTrackingFrame(false), createMotionContext('xr-standing'), 0, 1 / 60);
        const world = composeAvatarWorldPoses(seedPose);
        const flippedQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, Math.PI / 2, 'YXZ'));
        const frame = createTrackingFrame(false);
        const trackedJoints: AvatarSkeletonJointName[] = [
            'leftHand',
            'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip',
            'leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip',
            'leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip',
            'leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip',
            'leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip'
        ];

        for (const jointName of trackedJoints) {
            const joint = world[jointName]!;
            frame.effectors[jointName] = {
                position: { x: joint.position.x, y: joint.position.y, z: joint.position.z },
                quaternion: { x: flippedQuat.x, y: flippedQuat.y, z: flippedQuat.z, w: flippedQuat.w }
            };
            frame.tracked[jointName] = true;
        }

        const pose = solver.solve(frame, createMotionContext('xr-standing'), 0, 1 / 60);
        const solvedWorld = composeAvatarWorldPoses(pose);

        expect(solvedWorld.leftIndexDistal?.position.distanceTo(world.leftIndexDistal!.position)).toBeLessThan(1e-4);
        expectChildAxisAlignment(pose, 'leftIndexMetacarpal', 'leftIndexProximal');
        expectChildAxisAlignment(pose, 'leftIndexProximal', 'leftIndexIntermediate');
        expectChildAxisAlignment(pose, 'leftIndexIntermediate', 'leftIndexDistal');
    });

    it('recovers tracked hand orientation from wrist and knuckle positions', () => {
        const solver = new AvatarMotionSolver();
        const frame = createTrackingFrame(false);
        const targetHandQuaternion = createHandWorldQuaternion(
            new THREE.Vector3(0.35, 0.92, 0.18),
            new THREE.Vector3(0.15, -0.05, 0.98)
        );
        const targetHandPosition = new THREE.Vector3(-0.42, 1.18, 0.22);
        setTrackedHandPose(frame, 'left', targetHandPosition, targetHandQuaternion);

        const pose = solver.solve(frame, createMotionContext('xr-standing'), 0, 1 / 60);
        const world = composeAvatarWorldPoses(pose);
        const targetBack = new THREE.Vector3(0, 1, 0).applyQuaternion(targetHandQuaternion);
        const targetThumb = new THREE.Vector3(0, 0, 1).applyQuaternion(targetHandQuaternion);
        const solvedBack = new THREE.Vector3(0, 1, 0).applyQuaternion(world.leftHand!.quaternion);
        const solvedThumb = new THREE.Vector3(0, 0, 1).applyQuaternion(world.leftHand!.quaternion);

        expect(solvedBack.dot(targetBack)).toBeGreaterThan(0.9999);
        expect(solvedThumb.dot(targetThumb)).toBeGreaterThan(0.995);
    });

    it('maps WebXR grip-space controllers through the controller hand offset', () => {
        const solver = new AvatarMotionSolver();
        const frame = createTrackingFrame(false);
        clearTrackedFingerSkeleton(frame, 'left');
        clearTrackedFingerSkeleton(frame, 'right');
        const leftHandWorldQuaternion = createHandWorldQuaternion(
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 0, 1)
        );
        const rightHandWorldQuaternion = createHandWorldQuaternion(
            new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 0, 1)
        );
        const leftRawGripQuaternion = leftHandWorldQuaternion.clone().multiply(createGripToHandOffset('left').invert());
        const rightRawGripQuaternion = rightHandWorldQuaternion.clone().multiply(createGripToHandOffset('right').invert());
        const leftAvatarGripQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: leftRawGripQuaternion.x,
            y: leftRawGripQuaternion.y,
            z: leftRawGripQuaternion.z,
            w: leftRawGripQuaternion.w
        });
        const rightAvatarGripQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rightRawGripQuaternion.x,
            y: rightRawGripQuaternion.y,
            z: rightRawGripQuaternion.z,
            w: rightRawGripQuaternion.w
        });

        frame.effectors.leftHand!.quaternion = leftAvatarGripQuaternion;
        frame.effectors.rightHand!.quaternion = rightAvatarGripQuaternion;

        const pose = solver.solve(frame, createMotionContext('xr-standing'), 0, 1 / 60);
        const world = composeAvatarWorldPoses(pose);

        expect(world.leftHand!.quaternion.angleTo(leftHandWorldQuaternion)).toBeLessThan(1e-4);
        expect(world.rightHand!.quaternion.angleTo(rightHandWorldQuaternion)).toBeLessThan(1e-4);
    });

    it('maps controller grip quaternions semantically instead of copying them as hand-bone rotations', () => {
        const solver = new AvatarMotionSolver();
        const frame = createTrackingFrame(false);
        clearTrackedFingerSkeleton(frame, 'left');
        const leftHandWorldQuaternion = createHandWorldQuaternion(
            new THREE.Vector3(0.25, 0.95, 0.18),
            new THREE.Vector3(0.15, -0.1, 0.98)
        );
        const leftRawGripQuaternion = leftHandWorldQuaternion.clone().multiply(createGripToHandOffset('left').invert());
        const leftAvatarGripQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: leftRawGripQuaternion.x,
            y: leftRawGripQuaternion.y,
            z: leftRawGripQuaternion.z,
            w: leftRawGripQuaternion.w
        });
        frame.effectors.leftHand!.quaternion = leftAvatarGripQuaternion;

        const pose = solver.solve(frame, createMotionContext('xr-standing'), 0, 1 / 60);
        const world = composeAvatarWorldPoses(pose);

        expect(world.leftHand!.quaternion.angleTo(leftHandWorldQuaternion)).toBeLessThan(1e-4);
    });
});
