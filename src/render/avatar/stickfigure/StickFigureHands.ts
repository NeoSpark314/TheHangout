import * as THREE from 'three';
import { AvatarSkeletonJointName, IAvatarSkeletonPose } from '../../../shared/avatar/AvatarSkeleton';
import { AvatarSkeletonWorldPoseMap, LEFT_HAND_FINGER_JOINTS, RIGHT_HAND_FINGER_JOINTS } from '../../../shared/avatar/AvatarSkeletonUtils';

type AvatarHandSide = 'left' | 'right';

const AVATAR_HAND_JOINTS: Record<AvatarHandSide, readonly AvatarSkeletonJointName[]> = {
    left: ['leftHand', ...LEFT_HAND_FINGER_JOINTS],
    right: ['rightHand', ...RIGHT_HAND_FINGER_JOINTS]
};

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

    public updateFromSkeleton(
        hand: AvatarHandSide,
        skeleton: IAvatarSkeletonPose,
        world: AvatarSkeletonWorldPoseMap,
        root: THREE.Object3D,
        lerpFactor: number
    ): void {
        const jointNames = AVATAR_HAND_JOINTS[hand];
        const wristWorld = world[jointNames[0]];
        const hasFingerData = jointNames.slice(1).some((jointName) => skeleton.tracked[jointName]);

        if (!wristWorld || hasFingerData) {
            this.wristMeshes[hand].visible = false;
        } else {
            this.wristMeshes[hand].visible = true;
            const wristPosition = wristWorld.position.clone();
            root.worldToLocal(wristPosition);
            this.wristMeshes[hand].position.lerp(wristPosition, lerpFactor);
        }

        for (let i = 0; i < jointNames.length; i += 1) {
            const jointPose = world[jointNames[i]];
            if (hasFingerData && jointPose) {
                const localPosition = jointPose.position.clone();
                root.worldToLocal(localPosition);
                this.handMeshes[hand][i].visible = true;
                this.handMeshes[hand][i].position.lerp(localPosition, lerpFactor);
            } else {
                this.handMeshes[hand][i].visible = false;
            }
        }

        this.updateHandSkeleton(hand, hasFingerData);
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
