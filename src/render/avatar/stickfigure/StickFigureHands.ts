import * as THREE from 'three';
import { AvatarHandSide, AVATAR_HAND_JOINTS, IAvatarSolvedHandPose } from '../shared/AvatarPoseSolver';

export class StickFigureHands {
    public static readonly HAND_INDICES = [
        0, 1, 1, 2, 2, 3, 3, 4,
        0, 5, 5, 6, 6, 7, 7, 8, 8, 9,
        0, 10, 10, 11, 11, 12, 12, 13, 13, 14,
        0, 15, 15, 16, 16, 17, 17, 18, 18, 19,
        0, 20, 20, 21, 21, 22, 22, 23, 23, 24
    ] as const;

    constructor(
        private wristMeshes: { left: THREE.Mesh; right: THREE.Mesh },
        private handMeshes: { left: THREE.Mesh[]; right: THREE.Mesh[] },
        private handCylinders: { left: THREE.Mesh[]; right: THREE.Mesh[] }
    ) { }

    public updateSolvedHand(hand: AvatarHandSide, solvedHand: IAvatarSolvedHandPose, lerpFactor: number): void {
        if (!solvedHand.wrist.present || solvedHand.hasFingerData) {
            this.wristMeshes[hand].visible = false;
        } else {
            this.wristMeshes[hand].visible = true;
            this.wristMeshes[hand].position.lerp(solvedHand.wrist.localPosition, lerpFactor);
            this.wristMeshes[hand].quaternion.slerp(solvedHand.wrist.localQuaternion, lerpFactor);
        }

        const jointNames = AVATAR_HAND_JOINTS[hand];
        for (let i = 0; i < jointNames.length; i += 1) {
            const jointPose = solvedHand.joints[jointNames[i]];
            if (solvedHand.hasFingerData && jointPose?.present) {
                this.handMeshes[hand][i].visible = true;
                this.handMeshes[hand][i].position.lerp(jointPose.localPosition, lerpFactor);
                this.handMeshes[hand][i].quaternion.slerp(jointPose.localQuaternion, lerpFactor);
            } else {
                this.handMeshes[hand][i].visible = false;
            }
        }

        this.updateHandSkeleton(hand, solvedHand.hasFingerData);
    }

    public getWristMarkerPosition(hand: AvatarHandSide): THREE.Vector3 {
        return this.handMeshes[hand][0].visible ? this.handMeshes[hand][0].position : this.wristMeshes[hand].position;
    }

    private updateHandSkeleton(hand: AvatarHandSide, hasJoints: boolean): void {
        const cylinders = this.handCylinders[hand];
        if (!hasJoints) {
            cylinders.forEach(c => c.visible = false);
            return;
        }
        for (let i = 0; i < cylinders.length; i++) {
            const startIdx = StickFigureHands.HAND_INDICES[i * 2];
            const endIdx = StickFigureHands.HAND_INDICES[i * 2 + 1];
            const startJoint = this.handMeshes[hand][startIdx];
            const endJoint = this.handMeshes[hand][endIdx];
            cylinders[i].visible = true;
            this.alignCylinder(cylinders[i], startJoint.position, endJoint.position);
        }
    }

    private alignCylinder(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        if (len < 0.001) {
            mesh.scale.set(0, 0, 0);
            return;
        }
        mesh.scale.set(1, len, 1);
        mesh.position.copy(start).addScaledVector(dir, 0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }
}
