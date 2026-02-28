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

export class StickFigureRig {
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
        const calculateIK = (
            shoulderBone: THREE.Bone,
            handLocalTarget: THREE.Vector3,
            isLeft: boolean
        ): { upperQuat: THREE.Quaternion, lowerQuat: THREE.Quaternion, elbowDist: number, wristDist: number } => {
            const parentBone = shoulderBone.parent;
            const targetInParent = handLocalTarget.clone();

            if (parentBone) {
                this.root.updateMatrixWorld(true);
                parentBone.updateMatrixWorld(true);
                targetInParent.applyMatrix4(this.root.matrixWorld);
                targetInParent.applyMatrix4(new THREE.Matrix4().copy(parentBone.matrixWorld).invert());
            }

            let upperArmLen = 0.32;
            let lowerArmLen = 0.32;
            const shoulderPos = shoulderBone.position.clone();
            const toTarget = new THREE.Vector3().subVectors(targetInParent, shoulderPos);
            const rawDist = Math.max(0.0001, toTarget.length());

            const nominalReach = upperArmLen + lowerArmLen;
            if (rawDist > nominalReach) {
                const stretch = rawDist / nominalReach;
                upperArmLen *= stretch;
                lowerArmLen *= stretch;
            }

            const maxReach = upperArmLen + lowerArmLen - 0.0001;
            const dist = Math.min(rawDist, maxReach);
            const dir = toTarget.multiplyScalar(1 / rawDist);

            const side = isLeft ? -1 : 1;
            const pole = new THREE.Vector3(side, 0, 0.35).normalize();
            const planeNormal = new THREE.Vector3().crossVectors(dir, pole);
            if (planeNormal.lengthSq() < 1e-6) planeNormal.set(0, 0, 1);
            planeNormal.normalize();
            const bendDir = new THREE.Vector3().crossVectors(planeNormal, dir).normalize();

            const a = (upperArmLen * upperArmLen - lowerArmLen * lowerArmLen + dist * dist) / (2 * dist);
            const hSq = Math.max(0, upperArmLen * upperArmLen - a * a);
            const h = Math.sqrt(hSq);
            const elbow = shoulderPos.clone().addScaledVector(dir, a).addScaledVector(bendDir, h);

            const upperDir = elbow.clone().sub(shoulderPos).normalize();
            const lowerDir = targetInParent.clone().sub(elbow).normalize();
            const baseDir = new THREE.Vector3(0, -1, 0);

            const upperQuat = new THREE.Quaternion().setFromUnitVectors(baseDir, upperDir);
            const lowerLocalDir = lowerDir.clone().applyQuaternion(upperQuat.clone().invert());
            const lowerQuat = new THREE.Quaternion().setFromUnitVectors(baseDir, lowerLocalDir);

            return { upperQuat, lowerQuat, elbowDist: upperArmLen, wristDist: lowerArmLen };
        };

        const leftIk = calculateIK(this.bones.leftShoulder, leftHandLocalPos, true);
        this.bones.leftUpperArm.quaternion.copy(leftIk.upperQuat);
        this.bones.leftLowerArm.position.set(0, -leftIk.elbowDist, 0);
        this.bones.leftLowerArm.quaternion.copy(leftIk.lowerQuat);
        this.setupLocalCylinder(this.visuals.leftUpperArm, leftIk.elbowDist);
        this.visuals.leftUpperArm.position.set(0, -leftIk.elbowDist * 0.5, 0);
        this.setupLocalCylinder(this.visuals.leftForearm, leftIk.wristDist);
        this.visuals.leftForearm.position.set(0, -leftIk.wristDist * 0.5, 0);

        const rightIk = calculateIK(this.bones.rightShoulder, rightHandLocalPos, false);
        this.bones.rightUpperArm.quaternion.copy(rightIk.upperQuat);
        this.bones.rightLowerArm.position.set(0, -rightIk.elbowDist, 0);
        this.bones.rightLowerArm.quaternion.copy(rightIk.lowerQuat);
        this.setupLocalCylinder(this.visuals.rightUpperArm, rightIk.elbowDist);
        this.visuals.rightUpperArm.position.set(0, -rightIk.elbowDist * 0.5, 0);
        this.setupLocalCylinder(this.visuals.rightForearm, rightIk.wristDist);
        this.visuals.rightForearm.position.set(0, -rightIk.wristDist * 0.5, 0);
    }

    private setupLocalCylinder(mesh: THREE.Mesh, length: number): void {
        if (length < 0.001) {
            mesh.scale.set(0, 0, 0);
        } else {
            mesh.scale.set(1, length, 1);
        }
    }
}
