import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AvatarMotionSolver } from './AvatarMotionSolver';
import { composeAvatarWorldPoses } from './AvatarSkeletonUtils';
import { AvatarSkeletonJointName, IAvatarMotionContext, IAvatarTrackingFrame } from './AvatarSkeleton';
import { AVATAR_REST_LOCAL_POSITIONS } from './AvatarCanonicalRig';
import {
    convertRawWorldDirectionToAvatarWorldDirection,
    convertRawWorldQuaternionToAvatarWorldQuaternion
} from './AvatarTrackingSpace';

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

function setProviderStyleTrackedHandPose(
    frame: IAvatarTrackingFrame,
    side: 'left' | 'right',
    handRawWorldPosition: THREE.Vector3,
    handRawWorldQuaternion: THREE.Quaternion
): void {
    const handName = side === 'left' ? 'leftHand' : 'rightHand';
    const chains = side === 'left' ? LEFT_TRACKED_HAND_CHAINS : RIGHT_TRACKED_HAND_CHAINS;
    const rawAvatarBasisRemap = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const avatarHandQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
        x: handRawWorldQuaternion.x,
        y: handRawWorldQuaternion.y,
        z: handRawWorldQuaternion.z,
        w: handRawWorldQuaternion.w
    });

    frame.effectors[handName] = {
        position: { x: handRawWorldPosition.x, y: handRawWorldPosition.y, z: handRawWorldPosition.z },
        quaternion: avatarHandQuaternion
    };
    frame.tracked[handName] = true;

    for (const chain of chains) {
        let parentRawWorldPosition = handRawWorldPosition.clone();

        for (const jointName of chain) {
            const avatarLocalPosition = AVATAR_REST_LOCAL_POSITIONS[jointName].clone();
            const rawLocalPosition = avatarLocalPosition.applyQuaternion(rawAvatarBasisRemap);
            const rawWorldPosition = rawLocalPosition.applyQuaternion(handRawWorldQuaternion).add(parentRawWorldPosition);
            frame.effectors[jointName] = {
                position: { x: rawWorldPosition.x, y: rawWorldPosition.y, z: rawWorldPosition.z },
                quaternion: avatarHandQuaternion
            };
            frame.tracked[jointName] = true;
            parentRawWorldPosition = rawWorldPosition;
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

    it('bends elbows and knees outward in the provider-style desktop pose', () => {
        const solver = new AvatarMotionSolver();
        const rawRootQuaternion = new THREE.Quaternion();
        const avatarRootQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawRootQuaternion.x,
            y: rawRootQuaternion.y,
            z: rawRootQuaternion.z,
            w: rawRootQuaternion.w
        });
        const rawHeadQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.1, 0, 'YXZ'));
        const avatarHeadQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawHeadQuaternion.x,
            y: rawHeadQuaternion.y,
            z: rawHeadQuaternion.z,
            w: rawHeadQuaternion.w
        });
        const frame: IAvatarTrackingFrame = {
            rootWorldPosition: { x: 0, y: 0, z: 0 },
            rootWorldQuaternion: avatarRootQuaternion,
            headWorldPose: {
                position: { x: 0.02, y: 1.68, z: 0.05 },
                quaternion: avatarHeadQuaternion
            },
            effectors: {
                leftHand: {
                    position: { x: -0.2, y: 1.2, z: -0.2 },
                    quaternion: avatarHeadQuaternion
                },
                rightHand: {
                    position: { x: 0.2, y: 1.2, z: -0.2 },
                    quaternion: avatarHeadQuaternion
                }
            },
            tracked: {
                head: true,
                leftHand: true,
                rightHand: true
            },
            seated: false
        };

        let pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        for (let i = 0; i < 8; i += 1) {
            pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        }

        const world = composeAvatarWorldPoses(pose);

        expect(world.leftLowerArm!.position.x).toBeLessThan(world.rightLowerArm!.position.x);
        expect(world.leftLowerArm!.position.x).toBeLessThan(0);
        expect(world.rightLowerArm!.position.x).toBeGreaterThan(0);
        expect(world.leftLowerLeg!.position.x).toBeLessThan(0);
        expect(world.rightLowerLeg!.position.x).toBeGreaterThan(0);
        expect(world.leftLowerLeg!.position.z).toBeLessThan(world.leftFoot!.position.z);
        expect(world.rightLowerLeg!.position.z).toBeLessThan(world.rightFoot!.position.z);
    });

    it('derives tracked hand pose from provider-style joint positions instead of raw XR joint quaternions', () => {
        const solver = new AvatarMotionSolver();
        const flippedQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, Math.PI / 2, 'YXZ'));
        const frame = {
            rootWorldPosition: { x: 0, y: 0, z: 0 },
            rootWorldQuaternion: convertRawWorldQuaternionToAvatarWorldQuaternion({ x: 0, y: 0, z: 0, w: 1 }),
            headWorldPose: {
                position: { x: 0.02, y: 1.68, z: -0.04 },
                quaternion: convertRawWorldQuaternionToAvatarWorldQuaternion({
                    x: 0,
                    y: Math.sin(0.15 / 2),
                    z: 0,
                    w: Math.cos(0.15 / 2)
                })
            },
            effectors: {},
            tracked: { head: true },
            seated: false
        } satisfies IAvatarTrackingFrame;
        const rawTrackedHandQuaternion = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(
                new THREE.Vector3(0, 0, -1),
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(1, 0, 0)
            )
        );
        setProviderStyleTrackedHandPose(frame, 'left', new THREE.Vector3(-0.28, 1.15, -0.25), rawTrackedHandQuaternion);
        for (const jointName of [
            'leftHand',
            'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip',
            'leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip',
            'leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip',
            'leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip',
            'leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip'
        ] as AvatarSkeletonJointName[]) {
            frame.effectors[jointName]!.quaternion = { x: flippedQuat.x, y: flippedQuat.y, z: flippedQuat.z, w: flippedQuat.w };
        }

        let pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        for (let i = 0; i < 8; i += 1) {
            pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        }
        const solvedWorld = composeAvatarWorldPoses(pose);
        const expectedAvatarQuaternion = new THREE.Quaternion(
            convertRawWorldQuaternionToAvatarWorldQuaternion({
                x: rawTrackedHandQuaternion.x,
                y: rawTrackedHandQuaternion.y,
                z: rawTrackedHandQuaternion.z,
                w: rawTrackedHandQuaternion.w
            }).x,
            convertRawWorldQuaternionToAvatarWorldQuaternion({
                x: rawTrackedHandQuaternion.x,
                y: rawTrackedHandQuaternion.y,
                z: rawTrackedHandQuaternion.z,
                w: rawTrackedHandQuaternion.w
            }).y,
            convertRawWorldQuaternionToAvatarWorldQuaternion({
                x: rawTrackedHandQuaternion.x,
                y: rawTrackedHandQuaternion.y,
                z: rawTrackedHandQuaternion.z,
                w: rawTrackedHandQuaternion.w
            }).z,
            convertRawWorldQuaternionToAvatarWorldQuaternion({
                x: rawTrackedHandQuaternion.x,
                y: rawTrackedHandQuaternion.y,
                z: rawTrackedHandQuaternion.z,
                w: rawTrackedHandQuaternion.w
            }).w
        );
        const rawFingerDirection = new THREE.Vector3(
            frame.effectors.leftIndexProximal!.position.x - frame.effectors.leftIndexMetacarpal!.position.x,
            frame.effectors.leftIndexProximal!.position.y - frame.effectors.leftIndexMetacarpal!.position.y,
            frame.effectors.leftIndexProximal!.position.z - frame.effectors.leftIndexMetacarpal!.position.z
        ).normalize();
        const expectedFingerDirectionData = convertRawWorldDirectionToAvatarWorldDirection({
            x: rawFingerDirection.x,
            y: rawFingerDirection.y,
            z: rawFingerDirection.z
        });
        const solvedFingerDirection = solvedWorld.leftIndexProximal!.position.clone()
            .sub(solvedWorld.leftIndexMetacarpal!.position)
            .normalize();
        const expectedFingerDirection = new THREE.Vector3(
            expectedFingerDirectionData.x,
            expectedFingerDirectionData.y,
            expectedFingerDirectionData.z
        ).normalize();

        expect(solvedWorld.leftHand!.quaternion.angleTo(expectedAvatarQuaternion)).toBeLessThan(1e-4);
        expect(solvedFingerDirection.dot(expectedFingerDirection)).toBeGreaterThan(0.98);
        expectChildAxisAlignment(pose, 'leftIndexMetacarpal', 'leftIndexProximal');
        expectChildAxisAlignment(pose, 'leftIndexProximal', 'leftIndexIntermediate');
        expectChildAxisAlignment(pose, 'leftIndexIntermediate', 'leftIndexDistal');
    });

    it('recovers tracked hand orientation from provider-style wrist and knuckle positions', () => {
        const solver = new AvatarMotionSolver();
        const rawTargetHandQuaternion = createHandWorldQuaternion(
            new THREE.Vector3(0.35, 0.92, 0.18),
            new THREE.Vector3(0.15, -0.05, 0.98)
        );
        const targetHandPosition = new THREE.Vector3(-0.42, 1.18, -0.22);
        const frame = {
            rootWorldPosition: { x: 0, y: 0, z: 0 },
            rootWorldQuaternion: convertRawWorldQuaternionToAvatarWorldQuaternion({ x: 0, y: 0, z: 0, w: 1 }),
            headWorldPose: {
                position: { x: 0.02, y: 1.68, z: -0.04 },
                quaternion: convertRawWorldQuaternionToAvatarWorldQuaternion({
                    x: 0,
                    y: Math.sin(0.15 / 2),
                    z: 0,
                    w: Math.cos(0.15 / 2)
                })
            },
            effectors: {},
            tracked: { head: true },
            seated: false
        } satisfies IAvatarTrackingFrame;
        setProviderStyleTrackedHandPose(frame, 'left', targetHandPosition, rawTargetHandQuaternion);

        let pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        for (let i = 0; i < 8; i += 1) {
            pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        }
        const world = composeAvatarWorldPoses(pose);
        const avatarTargetHandQuaternionData = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawTargetHandQuaternion.x,
            y: rawTargetHandQuaternion.y,
            z: rawTargetHandQuaternion.z,
            w: rawTargetHandQuaternion.w
        });
        const avatarTargetHandQuaternion = new THREE.Quaternion(
            avatarTargetHandQuaternionData.x,
            avatarTargetHandQuaternionData.y,
            avatarTargetHandQuaternionData.z,
            avatarTargetHandQuaternionData.w
        );
        const targetBack = new THREE.Vector3(0, 1, 0).applyQuaternion(avatarTargetHandQuaternion);
        const targetThumb = new THREE.Vector3(0, 0, 1).applyQuaternion(avatarTargetHandQuaternion);
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

    it('keeps provider-style raw world left and right hand targets on their correct sides', () => {
        const solver = new AvatarMotionSolver();
        const rawRootQuaternion = new THREE.Quaternion();
        const avatarRootQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawRootQuaternion.x,
            y: rawRootQuaternion.y,
            z: rawRootQuaternion.z,
            w: rawRootQuaternion.w
        });
        const rawHeadQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.15, 0, 'YXZ'));
        const avatarHeadQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawHeadQuaternion.x,
            y: rawHeadQuaternion.y,
            z: rawHeadQuaternion.z,
            w: rawHeadQuaternion.w
        });
        const frame: IAvatarTrackingFrame = {
            rootWorldPosition: { x: 0, y: 0, z: 0 },
            rootWorldQuaternion: avatarRootQuaternion,
            headWorldPose: {
                position: { x: 0.02, y: 1.68, z: -0.04 },
                quaternion: avatarHeadQuaternion
            },
            effectors: {
                leftHand: {
                    position: { x: -0.42, y: 1.16, z: -0.2 },
                    quaternion: avatarHeadQuaternion
                },
                rightHand: {
                    position: { x: 0.42, y: 1.16, z: -0.2 },
                    quaternion: avatarHeadQuaternion
                }
            },
            tracked: {
                head: true,
                leftHand: true,
                rightHand: true
            },
            seated: false
        };

        let pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        for (let i = 0; i < 8; i += 1) {
            pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        }

        const world = composeAvatarWorldPoses(pose);
        expect(world.leftHand!.position.x).toBeLessThan(0);
        expect(world.rightHand!.position.x).toBeGreaterThan(0);
        expect(world.leftHand!.position.x).toBeLessThan(world.rightHand!.position.x);
    });

    it('maps provider-style WebXR tracked hand skeletons into the canonical hand orientation', () => {
        const solver = new AvatarMotionSolver();
        const rawRootQuaternion = new THREE.Quaternion();
        const avatarRootQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawRootQuaternion.x,
            y: rawRootQuaternion.y,
            z: rawRootQuaternion.z,
            w: rawRootQuaternion.w
        });
        const rawHeadQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.15, 0, 'YXZ'));
        const avatarHeadQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawHeadQuaternion.x,
            y: rawHeadQuaternion.y,
            z: rawHeadQuaternion.z,
            w: rawHeadQuaternion.w
        });
        const rawTrackedHandQuaternion = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(
                new THREE.Vector3(0, 0, -1),
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(1, 0, 0)
            )
        );
        const frame: IAvatarTrackingFrame = {
            rootWorldPosition: { x: 0, y: 0, z: 0 },
            rootWorldQuaternion: avatarRootQuaternion,
            headWorldPose: {
                position: { x: 0.02, y: 1.68, z: -0.04 },
                quaternion: avatarHeadQuaternion
            },
            effectors: {},
            tracked: {
                head: true
            },
            seated: false
        };

        setProviderStyleTrackedHandPose(
            frame,
            'left',
            new THREE.Vector3(-0.28, 1.15, -0.25),
            rawTrackedHandQuaternion
        );

        let pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        for (let i = 0; i < 8; i += 1) {
            pose = solver.solve(frame, createMotionContext('desktop'), Math.PI, 1 / 60);
        }

        const world = composeAvatarWorldPoses(pose);
        const expectedAvatarHandQuaternionData = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawTrackedHandQuaternion.x,
            y: rawTrackedHandQuaternion.y,
            z: rawTrackedHandQuaternion.z,
            w: rawTrackedHandQuaternion.w
        });
        const expectedAvatarHandQuaternion = new THREE.Quaternion(
            expectedAvatarHandQuaternionData.x,
            expectedAvatarHandQuaternionData.y,
            expectedAvatarHandQuaternionData.z,
            expectedAvatarHandQuaternionData.w
        );
        const rawFingerDirection = new THREE.Vector3(
            frame.effectors.leftIndexProximal!.position.x - frame.effectors.leftIndexMetacarpal!.position.x,
            frame.effectors.leftIndexProximal!.position.y - frame.effectors.leftIndexMetacarpal!.position.y,
            frame.effectors.leftIndexProximal!.position.z - frame.effectors.leftIndexMetacarpal!.position.z
        ).normalize();
        const expectedFingerDirectionData = convertRawWorldDirectionToAvatarWorldDirection({
            x: rawFingerDirection.x,
            y: rawFingerDirection.y,
            z: rawFingerDirection.z
        });
        const solvedFingerDirection = world.leftIndexProximal!.position.clone()
            .sub(world.leftIndexMetacarpal!.position)
            .normalize();
        const expectedFingerDirection = new THREE.Vector3(
            expectedFingerDirectionData.x,
            expectedFingerDirectionData.y,
            expectedFingerDirectionData.z
        ).normalize();

        expect(world.leftHand!.quaternion.angleTo(expectedAvatarHandQuaternion)).toBeLessThan(1e-4);
        expect(solvedFingerDirection.dot(expectedFingerDirection)).toBeGreaterThan(0.98);
    });
});
