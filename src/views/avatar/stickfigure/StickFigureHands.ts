import * as THREE from 'three';
import { HumanoidState } from '../../../models/HumanoidState';
import { HumanoidJointName } from '../../../interfaces/IHumanoid';

export class StickFigureHands {
    public static readonly HAND_INDICES = [
        0, 1, 1, 2, 2, 3, 3, 4,
        0, 5, 5, 6, 6, 7, 7, 8, 8, 9,
        0, 10, 10, 11, 11, 12, 12, 13, 13, 14,
        0, 15, 15, 16, 16, 17, 17, 18, 18, 19,
        0, 20, 20, 21, 21, 22, 22, 23, 23, 24
    ] as const;

    private static readonly HUM_JOINTS = {
        left: [
            'leftHand',
            'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'leftThumbTip',
            'leftIndexMetacarpal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftIndexTip',
            'leftMiddleMetacarpal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftMiddleTip',
            'leftRingMetacarpal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftRingTip',
            'leftLittleMetacarpal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'leftLittleTip'
        ] as HumanoidJointName[],
        right: [
            'rightHand',
            'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal', 'rightThumbTip',
            'rightIndexMetacarpal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightIndexTip',
            'rightMiddleMetacarpal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightMiddleTip',
            'rightRingMetacarpal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightRingTip',
            'rightLittleMetacarpal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal', 'rightLittleTip'
        ] as HumanoidJointName[]
    };

    constructor(
        private root: THREE.Object3D,
        private wristMeshes: { left: THREE.Mesh; right: THREE.Mesh },
        private handMeshes: { left: THREE.Mesh[]; right: THREE.Mesh[] },
        private handCylinders: { left: THREE.Mesh[]; right: THREE.Mesh[] }
    ) { }

    public updateHumanoidHand(hand: 'left' | 'right', humanoidInfo: HumanoidState | undefined, lerpFactor: number): void {
        const inverseWorldQuat = new THREE.Quaternion();
        this.root.getWorldQuaternion(inverseWorldQuat).invert();

        const jointNames = StickFigureHands.HUM_JOINTS[hand];
        let hasActiveFingers = false;

        if (humanoidInfo && humanoidInfo.joints) {
            const indexTip = jointNames[9];
            hasActiveFingers = !!humanoidInfo.joints[indexTip];
            const wristPose = humanoidInfo.joints[jointNames[0]];

            if (!wristPose || hasActiveFingers) {
                this.wristMeshes[hand].visible = false;
            } else {
                this.wristMeshes[hand].visible = true;
                const worldPos = new THREE.Vector3(wristPose.position.x, wristPose.position.y, wristPose.position.z);
                const worldQuat = new THREE.Quaternion(wristPose.quaternion.x, wristPose.quaternion.y, wristPose.quaternion.z, wristPose.quaternion.w);
                const localPos = this.root.worldToLocal(worldPos);
                const localQuat = inverseWorldQuat.clone().multiply(worldQuat);
                this.wristMeshes[hand].position.lerp(localPos, lerpFactor);
                this.wristMeshes[hand].quaternion.slerp(localQuat, lerpFactor);
            }

            for (let i = 0; i < 25; i++) {
                const p = humanoidInfo.joints[jointNames[i]];
                if (hasActiveFingers && p) {
                    this.handMeshes[hand][i].visible = true;
                    const worldPos = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
                    const worldQuat = new THREE.Quaternion(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w);
                    const localPos = this.root.worldToLocal(worldPos);
                    const localQuat = inverseWorldQuat.clone().multiply(worldQuat);
                    this.handMeshes[hand][i].position.lerp(localPos, lerpFactor);
                    this.handMeshes[hand][i].quaternion.slerp(localQuat, lerpFactor);
                } else {
                    this.handMeshes[hand][i].visible = false;
                }
            }
        } else {
            this.wristMeshes[hand].visible = false;
            for (let i = 0; i < 25; i++) {
                this.handMeshes[hand][i].visible = false;
            }
        }

        this.updateHandSkeleton(hand, hasActiveFingers);
    }

    public getWristMarkerPosition(hand: 'left' | 'right'): THREE.Vector3 {
        return this.handMeshes[hand][0].visible ? this.handMeshes[hand][0].position : this.wristMeshes[hand].position;
    }

    private updateHandSkeleton(hand: 'left' | 'right', hasJoints: boolean): void {
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
