import * as THREE from 'three';

export interface StickFigureBones {
    hips: THREE.Bone;
    spine: THREE.Bone;
    chest: THREE.Bone;
    neck: THREE.Bone;
    leftShoulder: THREE.Bone;
    leftUpperArm: THREE.Bone;
    leftLowerArm: THREE.Bone;
    rightShoulder: THREE.Bone;
    rightUpperArm: THREE.Bone;
    rightLowerArm: THREE.Bone;
    leftUpperLeg: THREE.Bone;
    leftLowerLeg: THREE.Bone;
    leftFoot: THREE.Bone;
    rightUpperLeg: THREE.Bone;
    rightLowerLeg: THREE.Bone;
    rightFoot: THREE.Bone;
}

export interface StickFigureRigVisuals {
    headMesh: THREE.Object3D;
    torso: THREE.Mesh;
    shoulders: THREE.Mesh;
    pelvis: THREE.Mesh;
    leftLeg: THREE.Mesh;
    leftLowerLegMesh: THREE.Mesh;
    rightLeg: THREE.Mesh;
    rightLowerLegMesh: THREE.Mesh;
    leftUpperArm: THREE.Mesh;
    leftForearm: THREE.Mesh;
    rightUpperArm: THREE.Mesh;
    rightForearm: THREE.Mesh;
}

interface IArmIkResult {
    upperQuat: THREE.Quaternion;
    lowerQuat: THREE.Quaternion;
    elbowDist: number;
    wristDist: number;
}

export class StickFigureRig {
    private readonly baseArmDir = new THREE.Vector3(0, -1, 0);
    private readonly leftPole = new THREE.Vector3(-1, 0, 0.35).normalize();
    private readonly rightPole = new THREE.Vector3(1, 0, 0.35).normalize();

    private readonly tmpTargetInParent = new THREE.Vector3();
    private readonly tmpParentInverse = new THREE.Matrix4();
    private readonly tmpShoulderPos = new THREE.Vector3();
    private readonly tmpToTarget = new THREE.Vector3();
    private readonly tmpDir = new THREE.Vector3();
    private readonly tmpPlaneNormal = new THREE.Vector3();
    private readonly tmpBendDir = new THREE.Vector3();
    private readonly tmpElbow = new THREE.Vector3();
    private readonly tmpUpperDir = new THREE.Vector3();
    private readonly tmpLowerDir = new THREE.Vector3();
    private readonly tmpInvUpperQuat = new THREE.Quaternion();
    private readonly tmpLowerLocalDir = new THREE.Vector3();

    private readonly leftIk: IArmIkResult = {
        upperQuat: new THREE.Quaternion(),
        lowerQuat: new THREE.Quaternion(),
        elbowDist: 0.32,
        wristDist: 0.32
    };
    private readonly rightIk: IArmIkResult = {
        upperQuat: new THREE.Quaternion(),
        lowerQuat: new THREE.Quaternion(),
        elbowDist: 0.32,
        wristDist: 0.32
    };

    constructor(
        private root: THREE.Object3D,
        private bones: StickFigureBones,
        private visuals: StickFigureRigVisuals,
        private onPostureUpdated?: () => void
    ) { }

    public updatePosture(headHeight: number): void {
        const neckHeight = Math.max(0.4, headHeight - 0.2);
        this.visuals.headMesh.position.y = neckHeight;

        const waistHeight = neckHeight * 0.6;
        this.bones.hips.position.set(0, waistHeight, 0);

        const spineLength = neckHeight - waistHeight;
        this.bones.spine.position.set(0, 0, 0);
        const chestRatio = 0.62;
        this.bones.chest.position.set(0, spineLength * chestRatio, 0);
        this.bones.neck.position.set(0, spineLength * (1 - chestRatio), 0);

        this.setupLocalCylinder(this.visuals.torso, spineLength);
        this.visuals.torso.position.set(0, spineLength * 0.5, 0);

        const shoulderWidth = 0.5;
        this.bones.leftShoulder.position.set(-shoulderWidth / 2, 0, 0);
        this.bones.rightShoulder.position.set(shoulderWidth / 2, 0, 0);
        this.setupLocalCylinder(this.visuals.shoulders, shoulderWidth);
        this.visuals.shoulders.rotation.z = Math.PI / 2;

        const legLength = waistHeight;
        const upperLegLength = legLength * 0.5;
        const lowerLegLength = legLength * 0.5;

        const pelvisWidth = 0.3;
        this.setupLocalCylinder(this.visuals.pelvis, pelvisWidth);
        this.visuals.pelvis.rotation.z = Math.PI / 2;

        this.bones.leftUpperLeg.position.set(-pelvisWidth / 2, 0, 0);
        this.bones.leftLowerLeg.position.set(0, -upperLegLength, 0);
        this.setupLocalCylinder(this.visuals.leftLeg, upperLegLength);
        this.visuals.leftLeg.position.set(0, -upperLegLength * 0.5, 0);
        this.setupLocalCylinder(this.visuals.leftLowerLegMesh, lowerLegLength);
        this.visuals.leftLowerLegMesh.position.set(0, -lowerLegLength * 0.5, 0);
        this.bones.leftFoot.position.set(0, -lowerLegLength, 0);

        this.bones.rightUpperLeg.position.set(0.15, 0, 0);
        this.bones.rightLowerLeg.position.set(0, -upperLegLength, 0);
        this.setupLocalCylinder(this.visuals.rightLeg, upperLegLength);
        this.visuals.rightLeg.position.set(0, -upperLegLength * 0.5, 0);
        this.setupLocalCylinder(this.visuals.rightLowerLegMesh, lowerLegLength);
        this.visuals.rightLowerLegMesh.position.set(0, -lowerLegLength * 0.5, 0);
        this.bones.rightFoot.position.set(0, -lowerLegLength, 0);

        if (this.onPostureUpdated) this.onPostureUpdated();
    }

    public updateArms(leftHandLocalPos: THREE.Vector3, rightHandLocalPos: THREE.Vector3): void {
        this.root.updateMatrixWorld(true);

        this.solveArmIK(this.bones.leftShoulder, leftHandLocalPos, true, this.leftIk);
        this.bones.leftUpperArm.quaternion.copy(this.leftIk.upperQuat);
        this.bones.leftLowerArm.position.set(0, -this.leftIk.elbowDist, 0);
        this.bones.leftLowerArm.quaternion.copy(this.leftIk.lowerQuat);
        this.setupLocalCylinder(this.visuals.leftUpperArm, this.leftIk.elbowDist);
        this.visuals.leftUpperArm.position.set(0, -this.leftIk.elbowDist * 0.5, 0);
        this.setupLocalCylinder(this.visuals.leftForearm, this.leftIk.wristDist);
        this.visuals.leftForearm.position.set(0, -this.leftIk.wristDist * 0.5, 0);

        this.solveArmIK(this.bones.rightShoulder, rightHandLocalPos, false, this.rightIk);
        this.bones.rightUpperArm.quaternion.copy(this.rightIk.upperQuat);
        this.bones.rightLowerArm.position.set(0, -this.rightIk.elbowDist, 0);
        this.bones.rightLowerArm.quaternion.copy(this.rightIk.lowerQuat);
        this.setupLocalCylinder(this.visuals.rightUpperArm, this.rightIk.elbowDist);
        this.visuals.rightUpperArm.position.set(0, -this.rightIk.elbowDist * 0.5, 0);
        this.setupLocalCylinder(this.visuals.rightForearm, this.rightIk.wristDist);
        this.visuals.rightForearm.position.set(0, -this.rightIk.wristDist * 0.5, 0);
    }

    private solveArmIK(
        shoulderBone: THREE.Bone,
        handLocalTarget: THREE.Vector3,
        isLeft: boolean,
        out: IArmIkResult
    ): void {
        const parentBone = shoulderBone.parent;
        this.tmpTargetInParent.copy(handLocalTarget);

        if (parentBone) {
            this.tmpTargetInParent.applyMatrix4(this.root.matrixWorld);
            this.tmpParentInverse.copy(parentBone.matrixWorld).invert();
            this.tmpTargetInParent.applyMatrix4(this.tmpParentInverse);
        }

        let upperArmLen = 0.32;
        let lowerArmLen = 0.32;
        this.tmpShoulderPos.copy(shoulderBone.position);
        this.tmpToTarget.subVectors(this.tmpTargetInParent, this.tmpShoulderPos);
        const rawDist = Math.max(0.0001, this.tmpToTarget.length());

        const nominalReach = upperArmLen + lowerArmLen;
        if (rawDist > nominalReach) {
            const stretch = rawDist / nominalReach;
            upperArmLen *= stretch;
            lowerArmLen *= stretch;
        }

        const maxReach = upperArmLen + lowerArmLen - 0.0001;
        const dist = Math.min(rawDist, maxReach);
        this.tmpDir.copy(this.tmpToTarget).multiplyScalar(1 / rawDist);

        this.tmpPlaneNormal.crossVectors(this.tmpDir, isLeft ? this.leftPole : this.rightPole);
        if (this.tmpPlaneNormal.lengthSq() < 1e-6) this.tmpPlaneNormal.set(0, 0, 1);
        this.tmpPlaneNormal.normalize();
        this.tmpBendDir.crossVectors(this.tmpPlaneNormal, this.tmpDir).normalize();

        const a = (upperArmLen * upperArmLen - lowerArmLen * lowerArmLen + dist * dist) / (2 * dist);
        const hSq = Math.max(0, upperArmLen * upperArmLen - a * a);
        const h = Math.sqrt(hSq);
        this.tmpElbow.copy(this.tmpShoulderPos).addScaledVector(this.tmpDir, a).addScaledVector(this.tmpBendDir, h);

        this.tmpUpperDir.subVectors(this.tmpElbow, this.tmpShoulderPos).normalize();
        this.tmpLowerDir.subVectors(this.tmpTargetInParent, this.tmpElbow).normalize();

        out.upperQuat.setFromUnitVectors(this.baseArmDir, this.tmpUpperDir);
        this.tmpInvUpperQuat.copy(out.upperQuat).invert();
        this.tmpLowerLocalDir.copy(this.tmpLowerDir).applyQuaternion(this.tmpInvUpperQuat);
        out.lowerQuat.setFromUnitVectors(this.baseArmDir, this.tmpLowerLocalDir);
        out.elbowDist = upperArmLen;
        out.wristDist = lowerArmLen;
    }

    private setupLocalCylinder(mesh: THREE.Mesh, length: number): void {
        if (length < 0.001) {
            mesh.scale.set(0, 0, 0);
        } else {
            mesh.scale.set(1, length, 1);
        }
    }
}
