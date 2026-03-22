import * as THREE from 'three';
import { ITrackingState } from '../../shared/contracts/ITrackingProvider';

type HandSide = 'left' | 'right';

const HAND_SIDES: HandSide[] = ['left', 'right'];
const HAND_INDICES = [
    0, 1, 1, 2, 2, 3, 3, 4,
    0, 5, 5, 6, 6, 7, 7, 8, 8, 9,
    0, 10, 10, 11, 11, 12, 12, 13, 13, 14,
    0, 15, 15, 16, 16, 17, 17, 18, 18, 19,
    0, 20, 20, 21, 21, 22, 22, 23, 23, 24
] as const;

interface IHandGhostMeshes {
    root: THREE.Group;
    controller: THREE.Mesh;
    pointer: THREE.Line;
    joints: THREE.Points;
    bones: THREE.LineSegments;
}

export class TrackedInputGhost {
    public readonly root = new THREE.Group();
    private readonly pointerMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
    });
    private readonly handMeshes: Record<HandSide, IHandGhostMeshes>;

    constructor() {
        this.root.name = 'tracked-input-ghost';
        this.handMeshes = {
            left: this.createHandGhost(0x7fd7ff),
            right: this.createHandGhost(0xffb37f)
        };

        for (const side of HAND_SIDES) {
            this.root.add(this.handMeshes[side].root);
        }
    }

    public update(state: ITrackingState | null | undefined): void {
        if (!state) {
            this.root.visible = false;
            return;
        }

        this.root.visible = true;
        for (const side of HAND_SIDES) {
            this.updateHand(side, state);
        }
    }

    public destroy(): void {
        this.pointerMaterial.dispose();
        for (const side of HAND_SIDES) {
            const hand = this.handMeshes[side];
            hand.controller.geometry.dispose();
            (hand.controller.material as THREE.Material).dispose();
            hand.pointer.geometry.dispose();
            hand.joints.geometry.dispose();
            (hand.joints.material as THREE.Material).dispose();
            hand.bones.geometry.dispose();
            (hand.bones.material as THREE.Material).dispose();
        }
    }

    private createHandGhost(color: number): IHandGhostMeshes {
        const root = new THREE.Group();
        const controllerMaterial = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.28,
            depthWrite: false
        });
        const jointMaterial = new THREE.PointsMaterial({
            color,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
            size: 0.018,
            sizeAttenuation: true
        });
        const boneMaterial = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.22,
            depthWrite: false
        });

        const controller = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.12), controllerMaterial);
        root.add(controller);

        const pointerGeometry = new THREE.BufferGeometry();
        pointerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
        const pointer = new THREE.Line(pointerGeometry, this.pointerMaterial);
        root.add(pointer);

        const jointGeometry = new THREE.BufferGeometry();
        jointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(25 * 3), 3));
        const joints = new THREE.Points(jointGeometry, jointMaterial);
        root.add(joints);

        const boneGeometry = new THREE.BufferGeometry();
        boneGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(HAND_INDICES.length * 3), 3));
        const bones = new THREE.LineSegments(boneGeometry, boneMaterial);
        root.add(bones);

        return { root, controller, pointer, joints, bones };
    }

    private updateHand(side: HandSide, state: ITrackingState): void {
        const handState = state.hands[side];
        const meshes = this.handMeshes[side];
        const active = handState.active;
        meshes.root.visible = active;
        if (!active) {
            return;
        }

        if (handState.hasJoints) {
            meshes.controller.visible = false;
            meshes.pointer.visible = false;
            this.updateTrackedHandSkeleton(meshes, handState);
            return;
        }

        meshes.controller.visible = true;
        meshes.pointer.visible = true;
        meshes.controller.position.set(
            handState.pose.position.x,
            handState.pose.position.y,
            handState.pose.position.z
        );
        meshes.controller.quaternion.set(
            handState.pose.quaternion.x,
            handState.pose.quaternion.y,
            handState.pose.quaternion.z,
            handState.pose.quaternion.w
        );

        meshes.joints.visible = false;
        meshes.bones.visible = false;

        const positions = meshes.pointer.geometry.getAttribute('position') as THREE.BufferAttribute;
        positions.setXYZ(0, handState.pose.position.x, handState.pose.position.y, handState.pose.position.z);
        positions.setXYZ(1, handState.pointerPose.position.x, handState.pointerPose.position.y, handState.pointerPose.position.z);
        positions.needsUpdate = true;
        meshes.pointer.geometry.computeBoundingSphere();
    }

    private updateTrackedHandSkeleton(meshes: IHandGhostMeshes, handState: ITrackingState['hands']['left']): void {
        meshes.joints.visible = true;
        meshes.bones.visible = true;

        const jointPositions = meshes.joints.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < 25; i += 1) {
            const jointState = handState.joints[i];
            jointPositions.setXYZ(
                i,
                jointState.pose.position.x,
                jointState.pose.position.y,
                jointState.pose.position.z
            );
        }
        jointPositions.needsUpdate = true;
        meshes.joints.geometry.computeBoundingSphere();

        const bonePositions = meshes.bones.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < HAND_INDICES.length / 2; i += 1) {
            const startIdx = HAND_INDICES[i * 2];
            const endIdx = HAND_INDICES[i * 2 + 1];
            const start = handState.joints[startIdx].pose.position;
            const end = handState.joints[endIdx].pose.position;
            bonePositions.setXYZ(i * 2, start.x, start.y, start.z);
            bonePositions.setXYZ(i * 2 + 1, end.x, end.y, end.z);
        }
        bonePositions.needsUpdate = true;
        meshes.bones.geometry.computeBoundingSphere();
    }
}
