import * as THREE from 'three';
import { AppContext } from '../../../app/AppContext';
import { AVATAR_SKELETON_JOINTS, AvatarSkeletonJointName, AVATAR_SKELETON_PARENT } from '../../../shared/avatar/AvatarSkeleton';
import { composeAvatarWorldPoses } from '../../../shared/avatar/AvatarSkeletonUtils';
import { BaseAvatarView } from '../BaseAvatarView';
import { IPlayerAvatarRenderState } from '../IPlayerAvatarRenderState';

export class CoordinateAvatarView extends BaseAvatarView {
    private readonly rootAxes = new THREE.AxesHelper(0.45);
    private readonly originMarkerMaterial: THREE.MeshBasicMaterial;
    private readonly originMarker: THREE.Mesh;
    private readonly jointAxes: Record<AvatarSkeletonJointName, THREE.AxesHelper>;
    private readonly headAnchor = new THREE.Group();
    private readonly tmpRootPos = new THREE.Vector3();
    private readonly tmpRootQuat = new THREE.Quaternion();
    private readonly tmpInverseRootQuat = new THREE.Quaternion();
    private readonly tmpLocalPos = new THREE.Vector3();
    private readonly tmpParentLocalPos = new THREE.Vector3();
    private readonly tmpLocalQuat = new THREE.Quaternion();

    private readonly linesMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    private readonly linesGeometry = new THREE.BufferGeometry();
    private readonly linesMesh: THREE.LineSegments;
    private readonly linePoints = new Float32Array(AVATAR_SKELETON_JOINTS.length * 6);

    constructor(
        context: AppContext,
        {
            color = 0x00ffff,
            isLocal = false
        }: {
            color?: string | number;
            isLocal?: boolean;
        } = {}
    ) {
        const headAnchor = new THREE.Group();
        super(context, new THREE.Group(), headAnchor, { color, isLocal });
        this.headAnchor = headAnchor;

        this.originMarkerMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        this.originMarker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), this.originMarkerMaterial);
        this.originMarker.name = 'AvatarOriginMarker';

        this.linesGeometry.setAttribute('position', new THREE.BufferAttribute(this.linePoints, 3));
        this.linesMesh = new THREE.LineSegments(this.linesGeometry, this.linesMaterial);
        
        this.mesh.add(this.rootAxes, this.originMarker, this.headAnchor, this.linesMesh);

        this.jointAxes = Object.fromEntries(
            AVATAR_SKELETON_JOINTS.map((jointName) => {
                const axes = new THREE.AxesHelper(this.getJointAxesSize(jointName));
                axes.name = `JointAxes:${jointName}`;
                this.mesh.add(axes);
                return [jointName, axes];
            })
        ) as Record<AvatarSkeletonJointName, THREE.AxesHelper>;
    }

    public applyState(state: IPlayerAvatarRenderState, delta: number): void {
        super.applyState(state, delta);
        const skeleton = state.skeleton;

        const world = composeAvatarWorldPoses(skeleton);
        this.tmpRootPos.copy(this.tmpTargetPos);
        this.tmpRootQuat.copy(this.tmpTargetQuat);
        this.tmpInverseRootQuat.copy(this.tmpRootQuat).invert();

        let lineIdx = 0;
        const positions = this.linesGeometry.attributes.position.array as Float32Array;

        for (const jointName of AVATAR_SKELETON_JOINTS) {
            const joint = world[jointName];
            const axes = this.jointAxes[jointName];
            if (!joint) {
                axes.visible = false;
                continue;
            }

            this.tmpLocalPos.copy(joint.position)
                .sub(this.tmpRootPos)
                .applyQuaternion(this.tmpInverseRootQuat);
            this.tmpLocalQuat.copy(this.tmpInverseRootQuat).multiply(joint.quaternion);

            axes.visible = true;
            axes.position.copy(this.tmpLocalPos);
            axes.quaternion.copy(this.tmpLocalQuat);

            const parentName = AVATAR_SKELETON_PARENT[jointName];
            const parentJoint = parentName ? world[parentName] : null;
            if (parentJoint) {
                this.tmpParentLocalPos.copy(parentJoint.position)
                    .sub(this.tmpRootPos)
                    .applyQuaternion(this.tmpInverseRootQuat);

                positions[lineIdx++] = this.tmpParentLocalPos.x;
                positions[lineIdx++] = this.tmpParentLocalPos.y;
                positions[lineIdx++] = this.tmpParentLocalPos.z;

                positions[lineIdx++] = this.tmpLocalPos.x;
                positions[lineIdx++] = this.tmpLocalPos.y;
                positions[lineIdx++] = this.tmpLocalPos.z;
            }
        }

        this.linesGeometry.setDrawRange(0, lineIdx / 3);
        this.linesGeometry.attributes.position.needsUpdate = true;

        const head = world.head;
        if (head) {
            this.tmpLocalPos.copy(head.position)
                .sub(this.tmpRootPos)
                .applyQuaternion(this.tmpInverseRootQuat);
            this.tmpLocalQuat.copy(this.tmpInverseRootQuat).multiply(head.quaternion);
            this.headAnchor.position.copy(this.tmpLocalPos);
            this.headAnchor.quaternion.copy(this.tmpLocalQuat);
            this.currentHeadAnchorY = Math.max(0.4, head.position.y - this.tmpRootPos.y);
        } else {
            this.headAnchor.position.set(0, this.currentHeadAnchorY, 0);
            this.headAnchor.quaternion.identity();
        }
    }

    public setColor(color: string | number): void {
        super.setColor(color);
        this.originMarkerMaterial.color.set(color as THREE.ColorRepresentation);
    }

    public destroy(): void {
        super.destroy();
        this.disposeAxesHelper(this.rootAxes);
        for (const axes of Object.values(this.jointAxes)) {
            this.disposeAxesHelper(axes);
        }
        this.originMarker.geometry.dispose();
        this.originMarkerMaterial.dispose();
        this.linesGeometry.dispose();
        this.linesMaterial.dispose();
    }

    private getJointAxesSize(jointName: AvatarSkeletonJointName): number {
        if (jointName.includes('Thumb') || jointName.includes('Index') || jointName.includes('Middle') || jointName.includes('Ring') || jointName.includes('Little')) {
            return 0.018;
        }
        return 0.06;
    }

    private disposeAxesHelper(axes: THREE.AxesHelper): void {
        axes.geometry.dispose();
        const materials = Array.isArray(axes.material) ? axes.material : [axes.material];
        for (const material of materials) {
            material.dispose();
        }
        axes.removeFromParent();
    }
}
