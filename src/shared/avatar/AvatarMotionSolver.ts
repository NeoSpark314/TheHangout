import * as THREE from 'three';
import {
    AVATAR_SKELETON_JOINTS,
    AVATAR_SKELETON_PARENT,
    IAvatarTrackingJoint,
    AvatarSkeletonJointName,
    createAvatarSkeletonPose,
    IAvatarMotionContext,
    IAvatarSkeletonPose,
    IAvatarTrackingFrame
} from './AvatarSkeleton';
import { AVATAR_REST_LOCAL_POSITIONS } from './AvatarCanonicalRig';
import {
    convertAvatarWorldQuaternionToRawWorldQuaternion,
    convertRawWorldQuaternionToAvatarWorldQuaternion
} from './AvatarTrackingSpace';
import {
    copyThreeQuaternion,
    copyThreeVector3,
    LEFT_HAND_FINGER_JOINTS,
    RIGHT_HAND_FINGER_JOINTS
} from './AvatarSkeletonUtils';

const MAX_TORSO_TWIST_YAW = THREE.MathUtils.degToRad(60);
const CHEST_TWIST_WEIGHT = 0.25;
const UPPER_CHEST_TWIST_WEIGHT = 0.35;
const NECK_TWIST_WEIGHT = 0.4;
const DEFAULT_PLAYER_HEIGHT_M = 1.8;
const CONTROLLER_RAW_GRIP_OFFSET = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2
);
const LEFT_FINGER_CHAINS: ReadonlyArray<readonly AvatarSkeletonJointName[]> = [
    ['leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip'],
    ['leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip'],
    ['leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip'],
    ['leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip'],
    ['leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip']
] as const;
const RIGHT_FINGER_CHAINS: ReadonlyArray<readonly AvatarSkeletonJointName[]> = [
    ['rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightThumbTip'],
    ['rightIndexMetacarpal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightIndexTip'],
    ['rightMiddleMetacarpal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightMiddleTip'],
    ['rightRingMetacarpal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightRingTip'],
    ['rightLittleMetacarpal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightLittleTip']
] as const;
const RAW_HAND_SPACE_REMAP = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI
);
// WebXR tracked-hand joint positions arrive in raw world space (-Z forward).
// We derive the rigid hand basis in that raw space, then convert the final
// hand orientation into canonical avatar space (+Z forward).
const LEFT_TRACKED_HAND_RAW_REST_BASIS = createTrackedHandBasisQuaternion(
    'left',
    AVATAR_REST_LOCAL_POSITIONS.leftIndexMetacarpal.clone().applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.leftMiddleMetacarpal.clone().applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.leftRingMetacarpal.clone().applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.leftLittleMetacarpal.clone().applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.leftIndexMetacarpal.clone().add(AVATAR_REST_LOCAL_POSITIONS.leftIndexProximal).applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.leftMiddleMetacarpal.clone().add(AVATAR_REST_LOCAL_POSITIONS.leftMiddleProximal).applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.leftRingMetacarpal.clone().add(AVATAR_REST_LOCAL_POSITIONS.leftRingProximal).applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.leftLittleMetacarpal.clone().add(AVATAR_REST_LOCAL_POSITIONS.leftLittleProximal).applyQuaternion(RAW_HAND_SPACE_REMAP)
)!;
const RIGHT_TRACKED_HAND_RAW_REST_BASIS = createTrackedHandBasisQuaternion(
    'right',
    AVATAR_REST_LOCAL_POSITIONS.rightIndexMetacarpal.clone().applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.rightMiddleMetacarpal.clone().applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.rightRingMetacarpal.clone().applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.rightLittleMetacarpal.clone().applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.rightIndexMetacarpal.clone().add(AVATAR_REST_LOCAL_POSITIONS.rightIndexProximal).applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.rightMiddleMetacarpal.clone().add(AVATAR_REST_LOCAL_POSITIONS.rightMiddleProximal).applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.rightRingMetacarpal.clone().add(AVATAR_REST_LOCAL_POSITIONS.rightRingProximal).applyQuaternion(RAW_HAND_SPACE_REMAP),
    AVATAR_REST_LOCAL_POSITIONS.rightLittleMetacarpal.clone().add(AVATAR_REST_LOCAL_POSITIONS.rightLittleProximal).applyQuaternion(RAW_HAND_SPACE_REMAP)
)!;

interface ITwoBoneSolveResult {
    upperQuaternion: THREE.Quaternion;
    lowerQuaternion: THREE.Quaternion;
    upperLength: number;
    lowerLength: number;
}

function createTrackedHandBasisQuaternion(
    side: 'left' | 'right',
    indexMetacarpal: THREE.Vector3,
    middleMetacarpal: THREE.Vector3,
    ringMetacarpal: THREE.Vector3,
    littleMetacarpal: THREE.Vector3,
    indexProximal: THREE.Vector3,
    middleProximal: THREE.Vector3,
    ringProximal: THREE.Vector3,
    littleProximal: THREE.Vector3
): THREE.Quaternion | null {
    const metacarpalCenter = new THREE.Vector3()
        .add(indexMetacarpal)
        .add(middleMetacarpal)
        .add(ringMetacarpal)
        .add(littleMetacarpal)
        .multiplyScalar(0.25);
    const proximalCenter = new THREE.Vector3()
        .add(indexProximal)
        .add(middleProximal)
        .add(ringProximal)
        .add(littleProximal)
        .multiplyScalar(0.25);
    const fingerBaseDirection = proximalCenter.sub(metacarpalCenter);
    if (fingerBaseDirection.lengthSq() < 1e-8) {
        return null;
    }
    fingerBaseDirection.normalize();

    const across = indexMetacarpal.clone().sub(littleMetacarpal);
    const thumbSide = across.sub(
        fingerBaseDirection.clone().multiplyScalar(across.dot(fingerBaseDirection))
    );
    if (thumbSide.lengthSq() < 1e-8) {
        return null;
    }
    thumbSide.normalize();

    const backOfHand = thumbSide.clone().cross(fingerBaseDirection);
    if (side === 'right') {
        backOfHand.multiplyScalar(-1);
    }
    if (backOfHand.lengthSq() < 1e-8) {
        return null;
    }
    backOfHand.normalize();

    const yAxis = backOfHand.clone();
    const zAxis = thumbSide.clone()
        .sub(yAxis.clone().multiplyScalar(thumbSide.dot(yAxis)));
    if (zAxis.lengthSq() < 1e-8) {
        return null;
    }
    zAxis.normalize();
    const xAxis = yAxis.clone().cross(zAxis).normalize();
    const fixedZ = xAxis.clone().cross(yAxis).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, fixedZ));
}

export class AvatarMotionSolver {
    private readonly pose = createAvatarSkeletonPose();
    private readonly jointWorldPositions: Partial<Record<AvatarSkeletonJointName, THREE.Vector3>> = {};
    private readonly jointWorldQuaternions: Partial<Record<AvatarSkeletonJointName, THREE.Quaternion>> = {};
    private readonly headTargetEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly headResidualEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly torsoEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    private readonly tmpRootWorldQuat = new THREE.Quaternion();
    private readonly tmpInverseRootWorldQuat = new THREE.Quaternion();
    private readonly tmpHeadWorldPos = new THREE.Vector3();
    private readonly tmpHeadLocalPos = new THREE.Vector3();
    private readonly tmpHeadWorldQuat = new THREE.Quaternion();
    private readonly tmpAvatarHeadWorldQuat = new THREE.Quaternion();
    private readonly tmpAvatarHeadLocalQuat = new THREE.Quaternion();
    private readonly tmpWorldTarget = new THREE.Vector3();
    private readonly tmpLocalTarget = new THREE.Vector3();
    private readonly tmpLocalQuat = new THREE.Quaternion();
    private readonly tmpParentWorldQuat = new THREE.Quaternion();
    private readonly tmpParentWorldPos = new THREE.Vector3();
    private readonly tmpTargetOrientation = new THREE.Quaternion();
    private readonly tmpTargetPosition = new THREE.Vector3();
    private readonly tmpChestQuat = new THREE.Quaternion();
    private readonly tmpUpperChestQuat = new THREE.Quaternion();
    private readonly tmpNeckQuat = new THREE.Quaternion();
    private bodyScale = 1;

    constructor() {
        for (const name of AVATAR_SKELETON_JOINTS) {
            const position = AVATAR_REST_LOCAL_POSITIONS[name];
            copyThreeVector3(position, this.pose.joints[name]!.position);
        }
    }

    public solve(frame: IAvatarTrackingFrame, context: IAvatarMotionContext, bodyWorldYaw: number, delta: number): IAvatarSkeletonPose {
        this.bodyScale = Math.max(0.6, (context.playerHeightM ?? DEFAULT_PLAYER_HEIGHT_M) / DEFAULT_PLAYER_HEIGHT_M);
        this.pose.rootWorldPosition = { ...frame.rootWorldPosition };
        this.pose.rootWorldQuaternion = {
            x: 0,
            y: Math.sin(bodyWorldYaw / 2),
            z: 0,
            w: Math.cos(bodyWorldYaw / 2)
        };
        this.pose.poseState = frame.seated ? 'seated' : 'standing';

        this.tmpRootWorldQuat.set(
            this.pose.rootWorldQuaternion.x,
            this.pose.rootWorldQuaternion.y,
            this.pose.rootWorldQuaternion.z,
            this.pose.rootWorldQuaternion.w
        );
        this.tmpInverseRootWorldQuat.copy(this.tmpRootWorldQuat).invert();
        this.tmpHeadWorldPos.set(
            frame.headWorldPose.position.x,
            frame.headWorldPose.position.y,
            frame.headWorldPose.position.z
        );
        this.tmpHeadWorldQuat.set(
            frame.headWorldPose.quaternion.x,
            frame.headWorldPose.quaternion.y,
            frame.headWorldPose.quaternion.z,
            frame.headWorldPose.quaternion.w
        );

        this.tmpHeadLocalPos.copy(this.tmpHeadWorldPos)
            .sub(new THREE.Vector3(frame.rootWorldPosition.x, frame.rootWorldPosition.y, frame.rootWorldPosition.z))
            .applyQuaternion(this.tmpInverseRootWorldQuat);
        this.tmpTargetOrientation.copy(this.tmpInverseRootWorldQuat).multiply(this.tmpHeadWorldQuat);
        this.headTargetEuler.setFromQuaternion(this.tmpTargetOrientation, 'YXZ');
        this.tmpAvatarHeadLocalQuat.setFromEuler(this.headTargetEuler);
        this.tmpAvatarHeadWorldQuat.copy(this.tmpRootWorldQuat).multiply(this.tmpAvatarHeadLocalQuat);

        this.solveTorso(context);
        this.solveArm('left', frame, context, delta);
        this.solveArm('right', frame, context, delta);
        this.solveLeg('left', frame.effectors.leftFoot || null, !!frame.tracked.leftFoot, frame.seated);
        this.solveLeg('right', frame.effectors.rightFoot || null, !!frame.tracked.rightFoot, frame.seated);
        this.solveFingers('left', frame);
        this.solveFingers('right', frame);

        return this.pose;
    }

    private solveTorso(context: IAvatarMotionContext): void {
        const standing = this.pose.poseState === 'standing';
        const hipsY = THREE.MathUtils.clamp(
            this.tmpHeadLocalPos.y - this.scaleScalar(standing ? 0.88 : 1.02),
            this.scaleScalar(standing ? 0.72 : 0.46),
            this.scaleScalar(standing ? 1.02 : 0.74)
        );
        const hipsPosition = new THREE.Vector3(
            THREE.MathUtils.clamp(this.tmpHeadLocalPos.x * 0.14, -this.scaleScalar(0.12), this.scaleScalar(0.12)),
            hipsY,
            THREE.MathUtils.clamp(this.tmpHeadLocalPos.z * (standing ? 0.1 : 0.22), -this.scaleScalar(0.12), this.scaleScalar(0.18))
        );
        const hipsQuat = new THREE.Quaternion();
        this.setJointLocal('hips', hipsPosition, hipsQuat, false);

        const torsoVector = this.tmpHeadLocalPos.clone().sub(hipsPosition);
        const torsoDistance = Math.max(0.35, torsoVector.length());
        const torsoDirection = torsoVector.normalize();
        const totalRest = this.getRest('spine').length()
            + this.getRest('chest').length()
            + this.getRest('upperChest').length()
            + this.getRest('neck').length()
            + this.getRest('head').length();
        const scaledSegment = (jointName: AvatarSkeletonJointName) =>
            torsoDirection.clone().multiplyScalar(torsoDistance * (this.getRest(jointName).length() / totalRest));

        const torsoYaw = THREE.MathUtils.clamp(this.headTargetEuler.y, -MAX_TORSO_TWIST_YAW, MAX_TORSO_TWIST_YAW);
        this.tmpChestQuat.setFromEuler(this.torsoEuler.set(0, torsoYaw * CHEST_TWIST_WEIGHT, 0, 'YXZ'));
        this.tmpUpperChestQuat.setFromEuler(this.torsoEuler.set(0, torsoYaw * UPPER_CHEST_TWIST_WEIGHT, 0, 'YXZ'));
        this.tmpNeckQuat.setFromEuler(this.torsoEuler.set(0, torsoYaw * NECK_TWIST_WEIGHT, 0, 'YXZ'));

        this.setJointLocal('spine', scaledSegment('spine'), new THREE.Quaternion(), false);
        this.setJointLocal('chest', scaledSegment('chest'), this.tmpChestQuat, false);
        this.setJointLocal('upperChest', scaledSegment('upperChest'), this.tmpUpperChestQuat, false);
        this.setJointLocal('neck', scaledSegment('neck'), this.tmpNeckQuat, false);

        this.headResidualEuler.set(
            this.headTargetEuler.x,
            this.headTargetEuler.y - torsoYaw,
            this.headTargetEuler.z,
            'YXZ'
        );
        this.tmpAvatarHeadLocalQuat.setFromEuler(this.headResidualEuler);
        this.setJointLocal('head', scaledSegment('head'), this.tmpAvatarHeadLocalQuat, true);
        this.setJointLocal('leftShoulder', this.getRest('leftShoulder'), new THREE.Quaternion(), false);
        this.setJointLocal('rightShoulder', this.getRest('rightShoulder'), new THREE.Quaternion(), false);
    }

    private solveArm(
        side: 'left' | 'right',
        frame: IAvatarTrackingFrame,
        context: IAvatarMotionContext,
        delta: number
    ): void {
        const upperName = side === 'left' ? 'leftUpperArm' : 'rightUpperArm';
        const lowerName = side === 'left' ? 'leftLowerArm' : 'rightLowerArm';
        const handName = side === 'left' ? 'leftHand' : 'rightHand';
        const shoulderName = side === 'left' ? 'leftShoulder' : 'rightShoulder';
        const effector = frame.effectors[handName] || null;
        const tracked = !!frame.tracked[handName];
        const hasTrackedHandSkeleton = this.hasTrackedHandSkeleton(side, frame);
        const upperBase = this.getRest(lowerName).normalize();
        const lowerBase = this.getRest(handName).normalize();
        const upperLength = this.getRest(lowerName).length();
        const lowerLength = this.getRest(handName).length();
        const shoulderWorldPos = this.jointWorldPositions[shoulderName]!;
        const shoulderWorldQuat = this.jointWorldQuaternions[shoulderName]!;
        const upperLocalPos = this.getRest(upperName);
        const restTarget = shoulderWorldPos.clone()
            .add(upperBase.clone().applyQuaternion(this.tmpRootWorldQuat).multiplyScalar(this.scaleScalar(0.58)))
            .add(new THREE.Vector3(0, -this.scaleScalar(0.38), this.scaleScalar(0.18)).applyQuaternion(this.tmpRootWorldQuat));

        this.tmpTargetPosition.copy(restTarget);
        this.tmpTargetOrientation.copy(this.tmpRootWorldQuat);

        if (effector) {
            this.tmpTargetPosition.set(effector.position.x, effector.position.y, effector.position.z);
            this.tmpTargetOrientation.set(
                effector.quaternion.x,
                effector.quaternion.y,
                effector.quaternion.z,
                effector.quaternion.w
            );
        }

        const targetHandPosition = this.tmpTargetPosition.clone();
        if (!effector) {
            this.smoothVector(targetHandPosition, restTarget, delta, 20);
        }

        const ik = this.solveTwoBoneLocal(
            shoulderWorldPos,
            shoulderWorldQuat,
            upperLocalPos,
            targetHandPosition,
            upperBase,
            upperLength,
            lowerBase,
            lowerLength,
            new THREE.Vector3(side === 'left' ? 0.5 : -0.5, -1, 0.5)
        );

        this.setJointLocal(upperName, upperLocalPos, ik.upperQuaternion, tracked);
        this.setJointLocal(lowerName, upperBase.clone().multiplyScalar(ik.upperLength), ik.lowerQuaternion, tracked);
        const handLocalPosition = lowerBase.clone().multiplyScalar(ik.lowerLength);
        this.setJointLocal(handName, handLocalPosition, new THREE.Quaternion(), tracked);
        if (hasTrackedHandSkeleton) {
            const trackedHandWorldQuaternion = this.deriveTrackedHandWorldQuaternion(side, frame);
            if (trackedHandWorldQuaternion) {
                this.setJointFromWorld(
                    handName,
                    targetHandPosition,
                    trackedHandWorldQuaternion,
                    tracked
                );
            } else if (effector) {
                this.setJointFromWorld(
                    handName,
                    targetHandPosition,
                    this.jointWorldQuaternions[lowerName]!.clone(),
                    tracked
                );
            }
        } else if (effector && context.mode !== 'desktop') {
            const controllerHandWorldQuaternion = this.deriveControllerHandWorldQuaternion(side, effector);
            this.setJointFromWorld(
                handName,
                targetHandPosition,
                controllerHandWorldQuaternion,
                tracked
            );
        }
    }

    private solveLeg(
        side: 'left' | 'right',
        effector: IAvatarTrackingFrame['effectors'][AvatarSkeletonJointName] | null,
        tracked: boolean,
        seated: boolean
    ): void {
        const upperName = side === 'left' ? 'leftUpperLeg' : 'rightUpperLeg';
        const lowerName = side === 'left' ? 'leftLowerLeg' : 'rightLowerLeg';
        const footName = side === 'left' ? 'leftFoot' : 'rightFoot';
        const toesName = side === 'left' ? 'leftToes' : 'rightToes';
        const upperBase = new THREE.Vector3(0, -1, 0);
        const lowerBase = new THREE.Vector3(0, -1, 0);
        const upperLength = Math.abs(this.getRest(lowerName).y);
        const lowerLength = Math.abs(this.getRest(footName).y);
        const hipsWorldPos = this.jointWorldPositions.hips!;
        const hipsWorldQuat = this.jointWorldQuaternions.hips!;
        const footForward = this.scaleScalar(seated ? 0.34 : 0.06);
        const footLift = this.scaleScalar(seated ? 0.08 : 0.0);
        const lateral = Math.sign(this.getRest(upperName).x) * this.scaleScalar(0.13);
        const footTargetLocal = new THREE.Vector3(
            lateral,
            footLift,
            footForward + THREE.MathUtils.clamp(this.tmpHeadLocalPos.z * 0.08, -this.scaleScalar(0.04), this.scaleScalar(0.12))
        );

        this.tmpTargetPosition.copy(footTargetLocal)
            .applyQuaternion(this.tmpRootWorldQuat)
            .add(new THREE.Vector3(
                this.pose.rootWorldPosition.x,
                this.pose.rootWorldPosition.y,
                this.pose.rootWorldPosition.z
            ));
        this.tmpTargetOrientation.copy(this.tmpRootWorldQuat);

        if (effector) {
            this.tmpTargetPosition.set(effector.position.x, effector.position.y, effector.position.z);
            this.tmpTargetOrientation.set(
                effector.quaternion.x,
                effector.quaternion.y,
                effector.quaternion.z,
                effector.quaternion.w
            );
        }

        const ik = this.solveTwoBoneLocal(
            hipsWorldPos,
            hipsWorldQuat,
            this.getRest(upperName),
            this.tmpTargetPosition,
            upperBase,
            upperLength,
            lowerBase,
            lowerLength,
            new THREE.Vector3(side === 'left' ? 0.2 : -0.2, 0, seated ? 0.5 : 0.2)
        );

        this.setJointLocal(upperName, this.getRest(upperName), ik.upperQuaternion, tracked);
        this.setJointLocal(lowerName, upperBase.clone().multiplyScalar(ik.upperLength), ik.lowerQuaternion, tracked);
        this.setJointLocal(footName, lowerBase.clone().multiplyScalar(ik.lowerLength), this.computeLocalQuaternionFromWorld(footName, this.tmpTargetOrientation), tracked);
        this.setJointLocal(toesName, this.getRest(toesName), new THREE.Quaternion(), tracked);
    }

    private solveFingers(side: 'left' | 'right', frame: IAvatarTrackingFrame): void {
        const handName = side === 'left' ? 'leftHand' : 'rightHand';
        const chains = side === 'left' ? LEFT_FINGER_CHAINS : RIGHT_FINGER_CHAINS;

        for (const chain of chains) {
            if (chain.some((jointName) => !!frame.effectors[jointName])) {
                this.solveTrackedFingerChain(chain, frame);
                continue;
            }

            for (const jointName of chain) {
                const restPosition = this.getRest(jointName);
                this.setJointLocal(jointName, restPosition, new THREE.Quaternion(), false);
            }
        }

        this.pose.tracked[handName] = this.pose.tracked[handName] ?? false;
    }

    private hasTrackedHandSkeleton(side: 'left' | 'right', frame: IAvatarTrackingFrame): boolean {
        const joints = side === 'left'
            ? LEFT_HAND_FINGER_JOINTS
            : RIGHT_HAND_FINGER_JOINTS;

        return joints.some((jointName) => !!frame.tracked[jointName]);
    }

    private deriveTrackedHandWorldQuaternion(
        side: 'left' | 'right',
        frame: IAvatarTrackingFrame
    ): THREE.Quaternion | null {
        const indexMetacarpal = side === 'left' ? 'leftIndexMetacarpal' : 'rightIndexMetacarpal';
        const middleMetacarpal = side === 'left' ? 'leftMiddleMetacarpal' : 'rightMiddleMetacarpal';
        const ringMetacarpal = side === 'left' ? 'leftRingMetacarpal' : 'rightRingMetacarpal';
        const littleMetacarpal = side === 'left' ? 'leftLittleMetacarpal' : 'rightLittleMetacarpal';
        const indexProximal = side === 'left' ? 'leftIndexProximal' : 'rightIndexProximal';
        const middleProximal = side === 'left' ? 'leftMiddleProximal' : 'rightMiddleProximal';
        const ringProximal = side === 'left' ? 'leftRingProximal' : 'rightRingProximal';
        const littleProximal = side === 'left' ? 'leftLittleProximal' : 'rightLittleProximal';
        const indexMetaPose = frame.effectors[indexMetacarpal];
        const middleMetaPose = frame.effectors[middleMetacarpal];
        const ringMetaPose = frame.effectors[ringMetacarpal];
        const littleMetaPose = frame.effectors[littleMetacarpal];
        const indexProxPose = frame.effectors[indexProximal];
        const middleProxPose = frame.effectors[middleProximal];
        const ringProxPose = frame.effectors[ringProximal];
        const littleProxPose = frame.effectors[littleProximal];
        if (
            !indexMetaPose || !middleMetaPose || !ringMetaPose || !littleMetaPose
            || !indexProxPose || !middleProxPose || !ringProxPose || !littleProxPose
        ) {
            return null;
        }

        const trackedBasis = createTrackedHandBasisQuaternion(
            side,
            new THREE.Vector3(indexMetaPose.position.x, indexMetaPose.position.y, indexMetaPose.position.z),
            new THREE.Vector3(middleMetaPose.position.x, middleMetaPose.position.y, middleMetaPose.position.z),
            new THREE.Vector3(ringMetaPose.position.x, ringMetaPose.position.y, ringMetaPose.position.z),
            new THREE.Vector3(littleMetaPose.position.x, littleMetaPose.position.y, littleMetaPose.position.z),
            new THREE.Vector3(indexProxPose.position.x, indexProxPose.position.y, indexProxPose.position.z),
            new THREE.Vector3(middleProxPose.position.x, middleProxPose.position.y, middleProxPose.position.z),
            new THREE.Vector3(ringProxPose.position.x, ringProxPose.position.y, ringProxPose.position.z),
            new THREE.Vector3(littleProxPose.position.x, littleProxPose.position.y, littleProxPose.position.z)
        );
        if (!trackedBasis) {
            return null;
        }

        const restBasis = side === 'left'
            ? LEFT_TRACKED_HAND_RAW_REST_BASIS
            : RIGHT_TRACKED_HAND_RAW_REST_BASIS;
        const rawHandWorldQuaternion = trackedBasis.multiply(restBasis.clone().invert());
        const avatarHandWorldQuaternion = convertRawWorldQuaternionToAvatarWorldQuaternion({
            x: rawHandWorldQuaternion.x,
            y: rawHandWorldQuaternion.y,
            z: rawHandWorldQuaternion.z,
            w: rawHandWorldQuaternion.w
        });
        return new THREE.Quaternion(
            avatarHandWorldQuaternion.x,
            avatarHandWorldQuaternion.y,
            avatarHandWorldQuaternion.z,
            avatarHandWorldQuaternion.w
        );
    }

    private deriveControllerHandWorldQuaternion(
        side: 'left' | 'right',
        effector: IAvatarTrackingJoint
    ): THREE.Quaternion {
        const rawGripQuaternion = new THREE.Quaternion();
        const rawGrip = convertAvatarWorldQuaternionToRawWorldQuaternion(effector.quaternion);
        rawGripQuaternion.set(rawGrip.x, rawGrip.y, rawGrip.z, rawGrip.w)
            .multiply(CONTROLLER_RAW_GRIP_OFFSET);
        const backOfHand = new THREE.Vector3(side === 'left' ? -1 : 1, 0, 0).applyQuaternion(rawGripQuaternion);
        const thumbSide = new THREE.Vector3(0, 0, -1).applyQuaternion(rawGripQuaternion);
        return this.createHandWorldQuaternion(backOfHand, thumbSide);
    }

    private solveTrackedFingerChain(
        chain: readonly AvatarSkeletonJointName[],
        frame: IAvatarTrackingFrame
    ): void {
        for (let i = 0; i < chain.length; i += 1) {
            const jointName = chain[i];
            const effector = frame.effectors[jointName];
            if (!effector) {
                for (let j = i; j < chain.length; j += 1) {
                    const fallbackJointName = chain[j];
                    const restPosition = this.getRest(fallbackJointName);
                    this.setJointLocal(
                        fallbackJointName,
                        restPosition,
                        new THREE.Quaternion(),
                        !!frame.tracked[fallbackJointName]
                    );
                }
                return;
            }

            const worldPosition = new THREE.Vector3(
                effector.position.x,
                effector.position.y,
                effector.position.z
            );
            const nextJointName = chain[i + 1];
            const nextEffector = nextJointName ? frame.effectors[nextJointName] : null;
            const parentName = AVATAR_SKELETON_PARENT[jointName];
            const parentWorldQuat = parentName
                ? this.jointWorldQuaternions[parentName]!
                : this.tmpRootWorldQuat;
            let localQuaternion = new THREE.Quaternion();

            if (nextJointName && nextEffector) {
                const targetDirection = new THREE.Vector3(
                    nextEffector.position.x - effector.position.x,
                    nextEffector.position.y - effector.position.y,
                    nextEffector.position.z - effector.position.z
                );
                if (targetDirection.lengthSq() > 1e-8) {
                    targetDirection.normalize().applyQuaternion(parentWorldQuat.clone().invert());
                    localQuaternion = new THREE.Quaternion().setFromUnitVectors(
                        this.getRest(nextJointName).normalize(),
                        targetDirection
                    );
                }
            }

            const worldQuaternion = parentWorldQuat.clone().multiply(localQuaternion);
            this.setJointFromWorld(
                jointName,
                worldPosition,
                worldQuaternion,
                !!frame.tracked[jointName]
            );
        }
    }



    private createHandWorldQuaternion(
        backOfHand: THREE.Vector3,
        thumbSide: THREE.Vector3
    ): THREE.Quaternion {
        const yAxis = backOfHand.clone().normalize();
        const zAxis = thumbSide.clone()
            .sub(yAxis.clone().multiplyScalar(thumbSide.dot(yAxis)));
        if (zAxis.lengthSq() < 1e-8) {
            return new THREE.Quaternion();
        }
        zAxis.normalize();
        const xAxis = yAxis.clone().cross(zAxis).normalize();
        const fixedZ = xAxis.clone().cross(yAxis).normalize();
        const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, fixedZ);
        return new THREE.Quaternion().setFromRotationMatrix(basis);
    }

    private setJointLocal(
        jointName: AvatarSkeletonJointName,
        localPosition: THREE.Vector3,
        localQuaternion: THREE.Quaternion,
        tracked: boolean
    ): void {
        const pose = this.pose.joints[jointName]!;
        copyThreeVector3(localPosition, pose.position);
        copyThreeQuaternion(localQuaternion, pose.quaternion);
        this.pose.tracked[jointName] = tracked;

        const parentName = AVATAR_SKELETON_PARENT[jointName];
        const parentWorldPos = parentName
            ? this.jointWorldPositions[parentName]!
            : this.tmpParentWorldPos.set(
                this.pose.rootWorldPosition.x,
                this.pose.rootWorldPosition.y,
                this.pose.rootWorldPosition.z
            );
        const parentWorldQuat = parentName
            ? this.jointWorldQuaternions[parentName]!
            : this.tmpRootWorldQuat;

        const worldPosition = this.jointWorldPositions[jointName] || new THREE.Vector3();
        const worldQuaternion = this.jointWorldQuaternions[jointName] || new THREE.Quaternion();
        worldPosition.copy(localPosition).applyQuaternion(parentWorldQuat).add(parentWorldPos);
        worldQuaternion.copy(parentWorldQuat).multiply(localQuaternion);
        this.jointWorldPositions[jointName] = worldPosition;
        this.jointWorldQuaternions[jointName] = worldQuaternion;
    }

    private setJointFromWorld(
        jointName: AvatarSkeletonJointName,
        worldPosition: THREE.Vector3,
        worldQuaternion: THREE.Quaternion,
        tracked: boolean
    ): void {
        const parentName = AVATAR_SKELETON_PARENT[jointName];
        const parentWorldPos = parentName
            ? this.jointWorldPositions[parentName]!
            : this.tmpParentWorldPos.set(
                this.pose.rootWorldPosition.x,
                this.pose.rootWorldPosition.y,
                this.pose.rootWorldPosition.z
            );
        const parentWorldQuat = parentName
            ? this.jointWorldQuaternions[parentName]!
            : this.tmpRootWorldQuat;
        this.tmpLocalTarget.copy(worldPosition).sub(parentWorldPos).applyQuaternion(parentWorldQuat.clone().invert());
        this.tmpLocalQuat.copy(parentWorldQuat).invert().multiply(worldQuaternion);
        this.setJointLocal(jointName, this.tmpLocalTarget.clone(), this.tmpLocalQuat.clone(), tracked);
    }

    private computeLocalQuaternionFromWorld(jointName: AvatarSkeletonJointName, worldQuaternion: THREE.Quaternion): THREE.Quaternion {
        const parentName = AVATAR_SKELETON_PARENT[jointName];
        const parentWorldQuat = parentName
            ? this.jointWorldQuaternions[parentName]!
            : this.tmpRootWorldQuat;
        return parentWorldQuat.clone().invert().multiply(worldQuaternion.clone());
    }

    private smoothVector(current: THREE.Vector3, target: THREE.Vector3, delta: number, speed: number): void {
        const alpha = 1 - Math.exp(-Math.max(0.0001, delta) * speed);
        current.lerp(target, THREE.MathUtils.clamp(alpha, 0, 1));
    }

    private solveTwoBoneLocal(
        parentWorldPos: THREE.Vector3,
        parentWorldQuat: THREE.Quaternion,
        upperLocalPosition: THREE.Vector3,
        targetWorldPosition: THREE.Vector3,
        baseUpperDirection: THREE.Vector3,
        upperLength: number,
        baseLowerDirection: THREE.Vector3,
        lowerLength: number,
        poleLocal: THREE.Vector3
    ): ITwoBoneSolveResult {
        const targetParentLocal = targetWorldPosition.clone()
            .sub(parentWorldPos)
            .applyQuaternion(parentWorldQuat.clone().invert());
        const upperPos = upperLocalPosition.clone();
        const toTarget = targetParentLocal.clone().sub(upperPos);
        const rawDistance = Math.max(0.0001, toTarget.length());
        const nominalReach = upperLength + lowerLength;
        const stretch = rawDistance > nominalReach ? rawDistance / nominalReach : 1;
        const solvedUpperLength = upperLength * stretch;
        const solvedLowerLength = lowerLength * stretch;
        const clampedDistance = Math.min(rawDistance, solvedUpperLength + solvedLowerLength - 0.0001);
        const direction = toTarget.clone().normalize();
        const planeNormal = direction.clone().cross(poleLocal);
        if (planeNormal.lengthSq() < 1e-6) planeNormal.set(0, 0, 1);
        planeNormal.normalize();
        const bendDirection = planeNormal.clone().cross(direction).normalize();
        const elbowDistance = (
            (solvedUpperLength * solvedUpperLength - solvedLowerLength * solvedLowerLength + clampedDistance * clampedDistance) /
            (2 * clampedDistance)
        );
        const bendHeightSq = Math.max(0, solvedUpperLength * solvedUpperLength - elbowDistance * elbowDistance);
        const elbow = upperPos.clone()
            .addScaledVector(direction, elbowDistance)
            .addScaledVector(bendDirection, Math.sqrt(bendHeightSq));
        const upperDirection = elbow.clone().sub(upperPos).normalize();
        const lowerDirection = targetParentLocal.clone().sub(elbow).normalize();
        const upperQuaternion = new THREE.Quaternion().setFromUnitVectors(baseUpperDirection, upperDirection);
        const lowerLocalDirection = lowerDirection.clone().applyQuaternion(upperQuaternion.clone().invert());
        const lowerQuaternion = new THREE.Quaternion().setFromUnitVectors(baseLowerDirection, lowerLocalDirection);
        return {
            upperQuaternion,
            lowerQuaternion,
            upperLength: solvedUpperLength,
            lowerLength: solvedLowerLength
        };
    }

    private getRest(jointName: AvatarSkeletonJointName): THREE.Vector3 {
        return AVATAR_REST_LOCAL_POSITIONS[jointName].clone().multiplyScalar(this.bodyScale);
    }

    private scaleScalar(value: number): number {
        return value * this.bodyScale;
    }
}
