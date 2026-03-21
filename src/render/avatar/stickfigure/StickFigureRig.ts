import * as THREE from 'three';
import { ITwoBoneIkResult, TwoBoneIkSolver } from '../shared/TwoBoneIkSolver';

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
    private readonly baseArmDir = new THREE.Vector3(0, -1, 0);
    private readonly leftPole = new THREE.Vector3(-1, 0, 0.35).normalize();
    private readonly rightPole = new THREE.Vector3(1, 0, 0.35).normalize();
    private readonly twoBoneIk = new TwoBoneIkSolver();
    private readonly leftIk: ITwoBoneIkResult = {
        upperQuaternion: new THREE.Quaternion(),
        lowerQuaternion: new THREE.Quaternion(),
        upperLength: 0.32,
        lowerLength: 0.32
    };
    private readonly rightIk: ITwoBoneIkResult = {
        upperQuaternion: new THREE.Quaternion(),
        lowerQuaternion: new THREE.Quaternion(),
        upperLength: 0.32,
        lowerLength: 0.32
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

        this.twoBoneIk.solve({
            rigRoot: this.root,
            upper: this.bones.leftShoulder,
            targetLocalPosition: leftHandLocalPos,
            baseUpperDirection: this.baseArmDir,
            baseLowerDirection: this.baseArmDir,
            upperLength: 0.32,
            lowerLength: 0.32,
            pole: this.leftPole,
            allowStretch: true
        }, this.leftIk);
        this.bones.leftUpperArm.quaternion.copy(this.leftIk.upperQuaternion);
        this.bones.leftLowerArm.position.set(0, -this.leftIk.upperLength, 0);
        this.bones.leftLowerArm.quaternion.copy(this.leftIk.lowerQuaternion);
        this.setupLocalCylinder(this.visuals.leftUpperArm, this.leftIk.upperLength);
        this.visuals.leftUpperArm.position.set(0, -this.leftIk.upperLength * 0.5, 0);
        this.setupLocalCylinder(this.visuals.leftForearm, this.leftIk.lowerLength);
        this.visuals.leftForearm.position.set(0, -this.leftIk.lowerLength * 0.5, 0);

        this.twoBoneIk.solve({
            rigRoot: this.root,
            upper: this.bones.rightShoulder,
            targetLocalPosition: rightHandLocalPos,
            baseUpperDirection: this.baseArmDir,
            baseLowerDirection: this.baseArmDir,
            upperLength: 0.32,
            lowerLength: 0.32,
            pole: this.rightPole,
            allowStretch: true
        }, this.rightIk);
        this.bones.rightUpperArm.quaternion.copy(this.rightIk.upperQuaternion);
        this.bones.rightLowerArm.position.set(0, -this.rightIk.upperLength, 0);
        this.bones.rightLowerArm.quaternion.copy(this.rightIk.lowerQuaternion);
        this.setupLocalCylinder(this.visuals.rightUpperArm, this.rightIk.upperLength);
        this.visuals.rightUpperArm.position.set(0, -this.rightIk.upperLength * 0.5, 0);
        this.setupLocalCylinder(this.visuals.rightForearm, this.rightIk.lowerLength);
        this.visuals.rightForearm.position.set(0, -this.rightIk.lowerLength * 0.5, 0);
    }

    private setupLocalCylinder(mesh: THREE.Mesh, length: number): void {
        if (length < 0.001) {
            mesh.scale.set(0, 0, 0);
        } else {
            mesh.scale.set(1, length, 1);
        }
    }
}
