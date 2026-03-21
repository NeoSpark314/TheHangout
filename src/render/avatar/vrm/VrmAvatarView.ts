import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { AppContext } from '../../../app/AppContext';
import { EntityView } from '../../views/EntityView';
import { NameTagComponent } from '../components/NameTagComponent';
import { VoiceAudioComponent } from '../components/VoiceAudioComponent';
import type { IPlayerAvatarRenderState } from '../IPlayerAvatarRenderState';
import type { IVrmInstance } from '../../../assets/runtime/IVrmAsset';
import { AvatarSkeletonJointName } from '../../../shared/avatar/AvatarSkeleton';
import { composeAvatarWorldPoses } from '../../../shared/avatar/AvatarSkeletonUtils';
import { VrmRetargetProfile } from './VrmRetargetProfile';
import { VrmHumanoidRetargeter } from './VrmHumanoidRetargeter';

interface IProxyArmVisuals {
    upper: THREE.Mesh;
    lower: THREE.Mesh;
    wrist: THREE.Mesh;
}

const FINGER_BONE_MAP: Array<{ humanoid: AvatarSkeletonJointName; vrm: VRMHumanBoneName }> = [
    { humanoid: 'leftThumbMetacarpal', vrm: VRMHumanBoneName.LeftThumbMetacarpal },
    { humanoid: 'leftThumbProximal', vrm: VRMHumanBoneName.LeftThumbProximal },
    { humanoid: 'leftThumbDistal', vrm: VRMHumanBoneName.LeftThumbDistal },
    { humanoid: 'leftIndexProximal', vrm: VRMHumanBoneName.LeftIndexProximal },
    { humanoid: 'leftIndexIntermediate', vrm: VRMHumanBoneName.LeftIndexIntermediate },
    { humanoid: 'leftIndexDistal', vrm: VRMHumanBoneName.LeftIndexDistal },
    { humanoid: 'leftMiddleProximal', vrm: VRMHumanBoneName.LeftMiddleProximal },
    { humanoid: 'leftMiddleIntermediate', vrm: VRMHumanBoneName.LeftMiddleIntermediate },
    { humanoid: 'leftMiddleDistal', vrm: VRMHumanBoneName.LeftMiddleDistal },
    { humanoid: 'leftRingProximal', vrm: VRMHumanBoneName.LeftRingProximal },
    { humanoid: 'leftRingIntermediate', vrm: VRMHumanBoneName.LeftRingIntermediate },
    { humanoid: 'leftRingDistal', vrm: VRMHumanBoneName.LeftRingDistal },
    { humanoid: 'leftLittleProximal', vrm: VRMHumanBoneName.LeftLittleProximal },
    { humanoid: 'leftLittleIntermediate', vrm: VRMHumanBoneName.LeftLittleIntermediate },
    { humanoid: 'leftLittleDistal', vrm: VRMHumanBoneName.LeftLittleDistal },
    { humanoid: 'rightThumbMetacarpal', vrm: VRMHumanBoneName.RightThumbMetacarpal },
    { humanoid: 'rightThumbProximal', vrm: VRMHumanBoneName.RightThumbProximal },
    { humanoid: 'rightThumbDistal', vrm: VRMHumanBoneName.RightThumbDistal },
    { humanoid: 'rightIndexProximal', vrm: VRMHumanBoneName.RightIndexProximal },
    { humanoid: 'rightIndexIntermediate', vrm: VRMHumanBoneName.RightIndexIntermediate },
    { humanoid: 'rightIndexDistal', vrm: VRMHumanBoneName.RightIndexDistal },
    { humanoid: 'rightMiddleProximal', vrm: VRMHumanBoneName.RightMiddleProximal },
    { humanoid: 'rightMiddleIntermediate', vrm: VRMHumanBoneName.RightMiddleIntermediate },
    { humanoid: 'rightMiddleDistal', vrm: VRMHumanBoneName.RightMiddleDistal },
    { humanoid: 'rightRingProximal', vrm: VRMHumanBoneName.RightRingProximal },
    { humanoid: 'rightRingIntermediate', vrm: VRMHumanBoneName.RightRingIntermediate },
    { humanoid: 'rightRingDistal', vrm: VRMHumanBoneName.RightRingDistal },
    { humanoid: 'rightLittleProximal', vrm: VRMHumanBoneName.RightLittleProximal },
    { humanoid: 'rightLittleIntermediate', vrm: VRMHumanBoneName.RightLittleIntermediate },
    { humanoid: 'rightLittleDistal', vrm: VRMHumanBoneName.RightLittleDistal }
];

export class VrmAvatarView extends EntityView<IPlayerAvatarRenderState> {
    public color: string | number;

    private readonly modelRoot: THREE.Group;
    private readonly rawHeadBone: THREE.Object3D | null;
    private readonly nameTagComponent: NameTagComponent;
    private readonly voiceAudio: VoiceAudioComponent;
    private readonly retargetProfile: VrmRetargetProfile;
    private readonly retargeter: VrmHumanoidRetargeter;
    private readonly fingerBones = new Map<AvatarSkeletonJointName, THREE.Object3D>();
    private readonly localProxyGroup = new THREE.Group();
    private readonly proxyMaterial: THREE.MeshBasicMaterial;
    private readonly leftProxy: IProxyArmVisuals;
    private readonly rightProxy: IProxyArmVisuals;
    private readonly tmpTargetPos = new THREE.Vector3();
    private readonly tmpTargetQuat = new THREE.Quaternion();
    private readonly tmpWorldQuat = new THREE.Quaternion();
    private readonly tmpParentWorldQuat = new THREE.Quaternion();
    private readonly tmpWorldPosA = new THREE.Vector3();
    private readonly tmpWorldPosB = new THREE.Vector3();
    private readonly tmpWorldPosC = new THREE.Vector3();
    private readonly tmpLocalPos = new THREE.Vector3();
    private readonly tmpCylinderStart = new THREE.Vector3();
    private readonly tmpCylinderEnd = new THREE.Vector3();
    private readonly tmpCylinderDir = new THREE.Vector3();
    private readonly restHipsPosition = new THREE.Vector3();
    private restHeadHeight = 1.6;
    private currentHeadAnchorY = 1.6;
    private usingLocalProxy = false;

    constructor(
        private readonly context: AppContext,
        private readonly vrmInstance: IVrmInstance,
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
        this.modelRoot = vrmInstance.scene;
        this.modelRoot.rotation.y = Math.PI;
        this.modelRoot.scale.setScalar(1);
        this.mesh.add(this.modelRoot);
        this.retargetProfile = new VrmRetargetProfile(this.vrmInstance.humanoid);
        this.retargeter = new VrmHumanoidRetargeter(this.retargetProfile);
        this.rawHeadBone = this.retargeter.getRawHeadBone();

        this.proxyMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        this.leftProxy = this.createProxyArm();
        this.rightProxy = this.createProxyArm();
        this.localProxyGroup.visible = false;
        this.localProxyGroup.add(
            this.leftProxy.upper,
            this.leftProxy.lower,
            this.leftProxy.wrist,
            this.rightProxy.upper,
            this.rightProxy.lower,
            this.rightProxy.wrist
        );
        this.mesh.add(this.localProxyGroup);

        this.captureFingerBones();
        this.captureHeadMetrics();

        const headAnchor = this.rawHeadBone || this.mesh;
        this.nameTagComponent = new NameTagComponent(this.mesh, () => this.currentHeadAnchorY, this.color);
        this.voiceAudio = new VoiceAudioComponent(headAnchor, this.context.runtime.render?.audioListener, isLocal);
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

        const world = this.retargeter.applySkeleton(skeleton, lerpFactor);
        this.updateFingers(state, world, lerpFactor);
        this.updateLocalSelfView();

        if (this.usingLocalProxy) {
            this.updateLocalProxyVisuals();
        }

        this.vrmInstance.update(delta);
        this.updateHeadAnchorHeight();

        this._billboardNameTag();
        if (state.name !== undefined) {
            this.setName(state.name);
        }

        if (state.color !== undefined && state.color !== this.color) {
            this.setColor(state.color);
        }
    }

    public setColor(color: string | number): void {
        this.color = color;
        const colorObj = new THREE.Color(color as THREE.ColorRepresentation);
        this.proxyMaterial.color.copy(colorObj);
        this.nameTagComponent.setColor(color);
    }

    public setName(name: string): void {
        this.nameTagComponent.setName(name);
    }

    public destroy(): void {
        this._cleanupMesh();
        this.voiceAudio.destroy();
        this.nameTagComponent.destroy();
        this.proxyMaterial.dispose();
        this.vrmInstance.dispose();
    }

    private captureFingerBones(): void {
        for (const entry of FINGER_BONE_MAP) {
            const node = this.vrmInstance.humanoid.getNormalizedBoneNode(entry.vrm);
            if (node) {
                this.fingerBones.set(entry.humanoid, node);
                node.userData.vrmRestQuaternion = node.quaternion.clone();
            }
        }
    }

    private captureHeadMetrics(): void {
        const head = this.rawHeadBone;
        if (!head) return;

        this.modelRoot.updateMatrixWorld(true);
        this.mesh.getWorldPosition(this.tmpWorldPosA);
        head.getWorldPosition(this.tmpWorldPosB);
        this.restHeadHeight = Math.max(0.6, this.tmpWorldPosB.y - this.tmpWorldPosA.y);
        this.currentHeadAnchorY = this.restHeadHeight;
        if (this.retargetProfile.hipsBone) {
            this.restHipsPosition.copy(this.retargetProfile.hipsBone.position);
        }
    }

    private applyWorldOrientation(node: THREE.Object3D, worldQuat: THREE.Quaternion, lerpFactor: number): void {
        this.tmpWorldQuat.copy(worldQuat);
        (node.parent || this.mesh).getWorldQuaternion(this.tmpParentWorldQuat);
        this.tmpParentWorldQuat.invert().multiply(this.tmpWorldQuat);
        if (lerpFactor < 1.0) {
            node.quaternion.slerp(this.tmpParentWorldQuat, lerpFactor);
        } else {
            node.quaternion.copy(this.tmpParentWorldQuat);
        }
    }

    private updateFingers(state: IPlayerAvatarRenderState, world: ReturnType<typeof composeAvatarWorldPoses>, lerpFactor: number): void {
        for (const [humanoidName, bone] of this.fingerBones.entries()) {
            const tracked = !!state.skeleton.tracked[humanoidName];
            const pose = world[humanoidName];
            if (!tracked || !pose) {
                const rest = bone.userData.vrmRestQuaternion as THREE.Quaternion | undefined;
                if (rest) {
                    if (lerpFactor < 1.0) {
                        bone.quaternion.slerp(rest, lerpFactor);
                    } else {
                        bone.quaternion.copy(rest);
                    }
                }
                continue;
            }

            this.applyWorldOrientation(bone, pose.quaternion, lerpFactor);
        }
    }

    private updateLocalSelfView(): void {
        const shouldUseProxy = !!this.mesh.userData.isLocalAvatar && !!this.context.runtime.render?.isXRPresenting?.();
        if (this.usingLocalProxy === shouldUseProxy) return;

        this.usingLocalProxy = shouldUseProxy;
        this.modelRoot.visible = !shouldUseProxy;
        this.localProxyGroup.visible = shouldUseProxy;
    }

    private createProxyArm(): IProxyArmVisuals {
        const geo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
        const wristGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);

        return {
            upper: new THREE.Mesh(geo, this.proxyMaterial),
            lower: new THREE.Mesh(geo.clone(), this.proxyMaterial),
            wrist: new THREE.Mesh(wristGeo, this.proxyMaterial)
        };
    }

    private updateLocalProxyVisuals(): void {
        const leftArm = this.retargeter.getLeftArmNodes();
        if (leftArm) {
            leftArm.upper.parent?.getWorldPosition(this.tmpWorldPosA);
            leftArm.lower.getWorldPosition(this.tmpWorldPosB);
            leftArm.hand.getWorldPosition(this.tmpWorldPosC);
            this.alignProxySegment(this.leftProxy.upper, this.tmpWorldPosA, this.tmpWorldPosB);
            this.alignProxySegment(this.leftProxy.lower, this.tmpWorldPosB, this.tmpWorldPosC);
            this.positionProxyWrist(this.leftProxy.wrist, this.tmpWorldPosC);
        }

        const rightArm = this.retargeter.getRightArmNodes();
        if (rightArm) {
            rightArm.upper.parent?.getWorldPosition(this.tmpWorldPosA);
            rightArm.lower.getWorldPosition(this.tmpWorldPosB);
            rightArm.hand.getWorldPosition(this.tmpWorldPosC);
            this.alignProxySegment(this.rightProxy.upper, this.tmpWorldPosA, this.tmpWorldPosB);
            this.alignProxySegment(this.rightProxy.lower, this.tmpWorldPosB, this.tmpWorldPosC);
            this.positionProxyWrist(this.rightProxy.wrist, this.tmpWorldPosC);
        }
    }

    private alignProxySegment(mesh: THREE.Mesh, worldStart: THREE.Vector3, worldEnd: THREE.Vector3): void {
        this.tmpCylinderStart.copy(worldStart);
        this.tmpCylinderEnd.copy(worldEnd);
        this.mesh.worldToLocal(this.tmpCylinderStart);
        this.mesh.worldToLocal(this.tmpCylinderEnd);
        this.tmpCylinderDir.subVectors(this.tmpCylinderEnd, this.tmpCylinderStart);
        const length = this.tmpCylinderDir.length();
        if (length < 0.0001) {
            mesh.visible = false;
            return;
        }

        mesh.visible = true;
        mesh.scale.set(1, length, 1);
        mesh.position.copy(this.tmpCylinderStart).addScaledVector(this.tmpCylinderDir, 0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmpCylinderDir.normalize());
    }

    private positionProxyWrist(mesh: THREE.Mesh, worldPos: THREE.Vector3): void {
        this.tmpLocalPos.copy(worldPos);
        this.mesh.worldToLocal(this.tmpLocalPos);
        mesh.visible = true;
        mesh.position.copy(this.tmpLocalPos);
    }

    private updateHeadAnchorHeight(): void {
        if (!this.rawHeadBone) {
            this.currentHeadAnchorY = this.restHeadHeight;
            return;
        }

        this.mesh.getWorldPosition(this.tmpWorldPosA);
        this.rawHeadBone.getWorldPosition(this.tmpWorldPosB);
        this.currentHeadAnchorY = Math.max(0.4, this.tmpWorldPosB.y - this.tmpWorldPosA.y);
    }

    private _billboardNameTag(): void {
        this.nameTagComponent.faceCamera(this.context.runtime.render?.camera);
        this.nameTagComponent.updatePosition();
    }
}


