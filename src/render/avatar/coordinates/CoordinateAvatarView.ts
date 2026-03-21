import * as THREE from 'three';
import { AppContext } from '../../../app/AppContext';
import { AVATAR_SKELETON_JOINTS, AvatarSkeletonJointName } from '../../../shared/avatar/AvatarSkeleton';
import { composeAvatarWorldPoses } from '../../../shared/avatar/AvatarSkeletonUtils';
import { EntityView } from '../../views/EntityView';
import { NameTagComponent } from '../components/NameTagComponent';
import { VoiceAudioComponent } from '../components/VoiceAudioComponent';
import { IPlayerAvatarRenderState } from '../IPlayerAvatarRenderState';

export class CoordinateAvatarView extends EntityView<IPlayerAvatarRenderState> {
    public color: string | number;

    private readonly rootAxes = new THREE.AxesHelper(0.45);
    private readonly originMarkerMaterial: THREE.MeshBasicMaterial;
    private readonly originMarker: THREE.Mesh;
    private readonly jointAxes: Record<AvatarSkeletonJointName, THREE.AxesHelper>;
    private readonly headAnchor = new THREE.Group();
    private readonly nameTagComponent: NameTagComponent;
    private readonly voiceAudio: VoiceAudioComponent;
    private readonly tmpTargetPos = new THREE.Vector3();
    private readonly tmpTargetQuat = new THREE.Quaternion();
    private readonly tmpRootPos = new THREE.Vector3();
    private readonly tmpRootQuat = new THREE.Quaternion();
    private readonly tmpInverseRootQuat = new THREE.Quaternion();
    private readonly tmpLocalPos = new THREE.Vector3();
    private readonly tmpLocalQuat = new THREE.Quaternion();
    private currentHeadAnchorY = 1.6;

    constructor(
        private readonly context: AppContext,
        {
            color = 0x00ffff,
            isLocal = false
        }: {
            color?: string | number;
            isLocal?: boolean;
        } = {}
    ) {
        super(new THREE.Group());
        this.color = color;
        this.originMarkerMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        this.originMarker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), this.originMarkerMaterial);
        this.originMarker.name = 'AvatarOriginMarker';
        this.mesh.add(this.rootAxes, this.originMarker, this.headAnchor);

        this.jointAxes = Object.fromEntries(
            AVATAR_SKELETON_JOINTS.map((jointName) => {
                const axes = new THREE.AxesHelper(this.getJointAxesSize(jointName));
                axes.name = `JointAxes:${jointName}`;
                this.mesh.add(axes);
                return [jointName, axes];
            })
        ) as Record<AvatarSkeletonJointName, THREE.AxesHelper>;

        this.nameTagComponent = new NameTagComponent(this.mesh, () => this.currentHeadAnchorY, this.color);
        this.voiceAudio = new VoiceAudioComponent(this.headAnchor, this.context.runtime.render?.audioListener, isLocal);
    }

    public applyState(state: IPlayerAvatarRenderState, delta: number): void {
        const lerpFactor = state.lerpFactor ?? 1.0;
        const skeleton = state.skeleton;

        this.tmpTargetPos.set(
            skeleton.rootWorldPosition.x,
            skeleton.rootWorldPosition.y,
            skeleton.rootWorldPosition.z
        );
        this.tmpTargetQuat.set(
            skeleton.rootWorldQuaternion.x,
            skeleton.rootWorldQuaternion.y,
            skeleton.rootWorldQuaternion.z,
            skeleton.rootWorldQuaternion.w
        );

        if (lerpFactor < 1.0) {
            this.mesh.position.lerp(this.tmpTargetPos, lerpFactor);
            this.mesh.quaternion.slerp(this.tmpTargetQuat, lerpFactor);
        } else {
            this.mesh.position.copy(this.tmpTargetPos);
            this.mesh.quaternion.copy(this.tmpTargetQuat);
        }

        const world = composeAvatarWorldPoses(skeleton);
        this.tmpRootPos.copy(this.tmpTargetPos);
        this.tmpRootQuat.copy(this.tmpTargetQuat);
        this.tmpInverseRootQuat.copy(this.tmpRootQuat).invert();

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
        }

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

        if (state.name !== undefined) {
            this.setName(state.name);
        }
        if (state.color !== undefined && state.color !== this.color) {
            this.setColor(state.color);
        }

        this.nameTagComponent.faceCamera(this.context.runtime.render?.camera);
        this.nameTagComponent.updatePosition();
    }

    public setColor(color: string | number): void {
        this.color = color;
        this.originMarkerMaterial.color.set(color as THREE.ColorRepresentation);
        this.nameTagComponent.setColor(color);
    }

    public setName(name: string): void {
        this.nameTagComponent.setName(name);
    }

    public attachVoiceStream(stream: MediaStream): void {
        this.voiceAudio.attachVoiceStream(stream);
    }

    public attachAudioChunk(data: { chunk: string; isHeader: boolean } | string): void {
        this.voiceAudio.attachAudioChunk(data);
    }

    public setMuted(muted: boolean): void {
        this.voiceAudio.setMuted(muted);
    }

    public getAudioLevel(): number {
        return this.voiceAudio.getAudioLevel();
    }

    public destroy(): void {
        this._cleanupMesh();
        this.disposeAxesHelper(this.rootAxes);
        for (const axes of Object.values(this.jointAxes)) {
            this.disposeAxesHelper(axes);
        }
        this.originMarker.geometry.dispose();
        this.originMarkerMaterial.dispose();
        this.voiceAudio.destroy();
        this.nameTagComponent.destroy();
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
