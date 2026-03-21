import * as THREE from 'three';
import { ITwoBoneIkResult, TwoBoneIkSolver } from '../shared/TwoBoneIkSolver';
import { IAvatarSkeletonPose } from '../../../shared/avatar/AvatarSkeleton';

export interface StickFigureBones {
    hips: THREE.Bone;
    spine: THREE.Bone;
    chest: THREE.Bone;
    upperChest: THREE.Bone;
    neck: THREE.Bone;
    head: THREE.Bone;
    leftShoulder: THREE.Bone;
    leftUpperArm: THREE.Bone;
    leftLowerArm: THREE.Bone;
    leftHand: THREE.Bone;
    rightShoulder: THREE.Bone;
    rightUpperArm: THREE.Bone;
    rightLowerArm: THREE.Bone;
    rightHand: THREE.Bone;
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
    private readonly segmentAxis = new THREE.Vector3(0, 1, 0);
    private readonly leftPole = new THREE.Vector3(-1, 0, 0.35).normalize();
    private readonly rightPole = new THREE.Vector3(1, 0, 0.35).normalize();
    private readonly twoBoneIk = new TwoBoneIkSolver();
    private readonly tmpSegmentStart = new THREE.Vector3();
    private readonly tmpSegmentEnd = new THREE.Vector3();
    private readonly tmpSegmentDelta = new THREE.Vector3();
    private readonly tmpSegmentMidpoint = new THREE.Vector3();
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

    public applySkeletonPose(pose: IAvatarSkeletonPose): void {
        const directBones: Array<keyof StickFigureBones> = [
            'hips', 'spine', 'chest', 'upperChest', 'neck',
            'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
            'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
            'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
            'rightUpperLeg', 'rightLowerLeg', 'rightFoot'
        ];

        for (const boneName of directBones) {
            const jointPose = pose.joints[boneName];
            const bone = this.bones[boneName];
            if (!jointPose || !bone) continue;
            bone.position.set(jointPose.position.x, jointPose.position.y, jointPose.position.z);
            bone.quaternion.set(
                jointPose.quaternion.x,
                jointPose.quaternion.y,
                jointPose.quaternion.z,
                jointPose.quaternion.w
            );
        }

        const headPose = pose.joints.head;
        if (headPose) {
            this.bones.head.position.set(headPose.position.x, headPose.position.y, headPose.position.z);
            this.bones.head.quaternion.set(
                headPose.quaternion.x,
                headPose.quaternion.y,
                headPose.quaternion.z,
                headPose.quaternion.w
            );
        }

        this.updateVisualsFromBones();
        if (this.onPostureUpdated) this.onPostureUpdated();
    }

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

    private updateVisualsFromBones(): void {
        this.root.updateMatrixWorld(true);

        this.setSegmentFromChild(this.visuals.torso, this.bones.spine, this.bones.upperChest);
        this.setSegmentBetweenSiblings(this.visuals.shoulders, this.bones.upperChest, this.bones.leftShoulder, this.bones.rightShoulder);
        this.setSegmentBetweenSiblings(this.visuals.pelvis, this.bones.hips, this.bones.leftUpperLeg, this.bones.rightUpperLeg);

        this.setSegmentFromChild(this.visuals.leftLeg, this.bones.leftUpperLeg, this.bones.leftLowerLeg);
        this.setSegmentFromChild(this.visuals.leftLowerLegMesh, this.bones.leftLowerLeg, this.bones.leftFoot);
        this.setSegmentFromChild(this.visuals.rightLeg, this.bones.rightUpperLeg, this.bones.rightLowerLeg);
        this.setSegmentFromChild(this.visuals.rightLowerLegMesh, this.bones.rightLowerLeg, this.bones.rightFoot);

        this.setSegmentFromChild(this.visuals.leftUpperArm, this.bones.leftUpperArm, this.bones.leftLowerArm);
        this.setSegmentFromChild(this.visuals.leftForearm, this.bones.leftLowerArm, this.bones.leftHand);
        this.setSegmentFromChild(this.visuals.rightUpperArm, this.bones.rightUpperArm, this.bones.rightLowerArm);
        this.setSegmentFromChild(this.visuals.rightForearm, this.bones.rightLowerArm, this.bones.rightHand);
    }

    private setSegmentFromChild(mesh: THREE.Mesh, parent: THREE.Object3D, child: THREE.Object3D): void {
        this.tmpSegmentStart.set(0, 0, 0);
        this.tmpSegmentEnd.setFromMatrixPosition(child.matrixWorld);
        parent.worldToLocal(this.tmpSegmentEnd);
        this.setSegment(mesh, this.tmpSegmentStart, this.tmpSegmentEnd);
    }

    private setSegmentBetweenSiblings(mesh: THREE.Mesh, parent: THREE.Object3D, start: THREE.Object3D, end: THREE.Object3D): void {
        this.tmpSegmentStart.setFromMatrixPosition(start.matrixWorld);
        parent.worldToLocal(this.tmpSegmentStart);
        this.tmpSegmentEnd.setFromMatrixPosition(end.matrixWorld);
        parent.worldToLocal(this.tmpSegmentEnd);
        this.setSegment(mesh, this.tmpSegmentStart, this.tmpSegmentEnd);
    }

    private setSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
        this.tmpSegmentDelta.copy(end).sub(start);
        const length = this.tmpSegmentDelta.length();
        this.setupLocalCylinder(mesh, length);

        if (length < 0.001) {
            mesh.position.copy(start);
            mesh.quaternion.identity();
            return;
        }

        this.tmpSegmentMidpoint.copy(start).add(end).multiplyScalar(0.5);
        mesh.position.copy(this.tmpSegmentMidpoint);
        mesh.quaternion.setFromUnitVectors(this.segmentAxis, this.tmpSegmentDelta.normalize());
    }
}
