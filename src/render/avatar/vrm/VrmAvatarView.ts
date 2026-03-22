import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { AppContext } from '../../../app/AppContext';
import { EntityView } from '../../views/EntityView';
import { NameTagComponent } from '../components/NameTagComponent';
import { VoiceAudioComponent } from '../components/VoiceAudioComponent';
import type { IPlayerAvatarRenderState } from '../IPlayerAvatarRenderState';
import type { IVrmInstance } from '../../../assets/runtime/IVrmAsset';
import { buildNormalizedVrmPose } from './VrmPoseBuilder';

interface IProxyArmVisuals {
    upper: THREE.Mesh;
    lower: THREE.Mesh;
    wrist: THREE.Mesh;
}

interface IVrmArmNodes {
    upper: THREE.Object3D;
    lower: THREE.Object3D;
    hand: THREE.Object3D;
}

export class VrmAvatarView extends EntityView<IPlayerAvatarRenderState> {
    public color: string | number;

    private readonly modelRoot: THREE.Group;
    private readonly rawHeadBone: THREE.Object3D | null;
    private readonly leftArmNodes: IVrmArmNodes | null;
    private readonly rightArmNodes: IVrmArmNodes | null;
    private readonly nameTagComponent: NameTagComponent;
    private readonly voiceAudio: VoiceAudioComponent;
    private readonly localProxyGroup = new THREE.Group();
    private readonly proxyMaterial: THREE.MeshBasicMaterial;
    private readonly leftProxy: IProxyArmVisuals;
    private readonly rightProxy: IProxyArmVisuals;
    private readonly tmpTargetPos = new THREE.Vector3();
    private readonly tmpTargetQuat = new THREE.Quaternion();
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
    private readonly vrmMeshes: THREE.Mesh[] = [];
    private readonly proxyMeshes: THREE.Mesh[] = [];

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
        this.modelRoot.scale.setScalar(1);
        this.mesh.add(this.modelRoot);
        this.rawHeadBone = this.vrmInstance.humanoid.getRawBoneNode(VRMHumanBoneName.Head);
        this.leftArmNodes = this.captureArmNodes('left');
        this.rightArmNodes = this.captureArmNodes('right');

        this.proxyMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        this.mesh.add(this.localProxyGroup);
        this.setupProxyArms();

        this.modelRoot.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
                this.vrmMeshes.push(obj as THREE.Mesh);
            }
        });

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

        this.vrmInstance.humanoid.setNormalizedPose(buildNormalizedVrmPose(state.humanoidPose));
        this.updateLocalSelfView();

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

    private captureArmNodes(side: 'left' | 'right'): IVrmArmNodes | null {
        const upper = this.vrmInstance.humanoid.getNormalizedBoneNode(
            side === 'left' ? VRMHumanBoneName.LeftUpperArm : VRMHumanBoneName.RightUpperArm
        );
        const lower = this.vrmInstance.humanoid.getNormalizedBoneNode(
            side === 'left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm
        );
        const hand = this.vrmInstance.humanoid.getNormalizedBoneNode(
            side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand
        );

        if (!upper || !lower || !hand) {
            return null;
        }

        return { upper, lower, hand };
    }

    private captureHeadMetrics(): void {
        const head = this.rawHeadBone;
        if (!head) return;

        this.modelRoot.updateMatrixWorld(true);
        this.mesh.getWorldPosition(this.tmpWorldPosA);
        head.getWorldPosition(this.tmpWorldPosB);
        this.restHeadHeight = Math.max(0.6, this.tmpWorldPosB.y - this.tmpWorldPosA.y);
        this.currentHeadAnchorY = this.restHeadHeight;
        const hipsBone = this.vrmInstance.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
        if (hipsBone) {
            this.restHipsPosition.copy(hipsBone.position);
        }
    }

    private updateLocalSelfView(): void {
        const shouldUseProxy = !!this.mesh.userData.isLocalAvatar && !!this.context.runtime.render?.isXRPresenting?.();
        if (this.usingLocalProxy === shouldUseProxy) return;

        this.usingLocalProxy = shouldUseProxy;
        for (const mesh of this.vrmMeshes) {
            mesh.visible = !shouldUseProxy;
        }
        for (const mesh of this.proxyMeshes) {
            mesh.visible = shouldUseProxy;
        }
    }

    private setupProxyArms(): void {
        const geo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
        const wristGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);

        const setupSegment = (bone: THREE.Object3D, nextBone: THREE.Object3D | null) => {
            const mesh = new THREE.Mesh(geo, this.proxyMaterial);
            if (nextBone) {
                const start = new THREE.Vector3();
                const end = new THREE.Vector3();
                bone.getWorldPosition(start);
                nextBone.getWorldPosition(end);
                const distance = start.distanceTo(end);
                mesh.scale.set(1, distance, 1);
                mesh.position.set(0, distance * 0.5, 0); // Correct for cylinder origin if needed, but bones usually point Y?
                // VRM bones in T-pose point towards their children. 
                // Normalized bones in three-vrm point +Y for arms? Let's check.
                // Actually, normalized bones are oriented such that identity is T-pose.
            }
            bone.add(mesh);
            return mesh;
        };

        const setupSide = (nodes: IVrmArmNodes | null) => {
            if (!nodes) return;
            const upper = new THREE.Mesh(geo, this.proxyMaterial);
            const lower = new THREE.Mesh(geo, this.proxyMaterial);
            const wrist = new THREE.Mesh(wristGeo, this.proxyMaterial);

            // In VRM normalized humanoid, bones usually point towards their child.
            // However, we need to know the length.
            const dUpper = nodes.upper.position.distanceTo(nodes.lower.position); // This is not correct because they are in different spaces.
            // But they are normalized...
            
            // Let's use a simpler approach: get world positions in T-pose (resetting pose briefly).
            const currentPose = this.vrmInstance.humanoid.getNormalizedPose();
            this.vrmInstance.humanoid.resetNormalizedPose();
            this.vrmInstance.scene.updateMatrixWorld(true);
            
            const p1 = new THREE.Vector3();
            const p2 = new THREE.Vector3();
            const p3 = new THREE.Vector3();
            
            nodes.upper.getWorldPosition(p1);
            nodes.lower.getWorldPosition(p2);
            nodes.hand.getWorldPosition(p3);
            
            const lenUpper = p1.distanceTo(p2);
            const lenLower = p2.distanceTo(p3);
            
            upper.scale.set(1, lenUpper, 1);
            upper.position.set(0, lenUpper * 0.5, 0);
            nodes.upper.add(upper);
            
            lower.scale.set(1, lenLower, 1);
            lower.position.set(0, lenLower * 0.5, 0);
            nodes.lower.add(lower);
            
            nodes.hand.add(wrist);
            
            upper.visible = this.usingLocalProxy;
            lower.visible = this.usingLocalProxy;
            wrist.visible = this.usingLocalProxy;
            
            this.proxyMeshes.push(upper, lower, wrist);
            
            // Re-apply pose
            this.vrmInstance.humanoid.setNormalizedPose(currentPose);
        };

        setupSide(this.leftArmNodes);
        setupSide(this.rightArmNodes);
        
        this.localProxyGroup.visible = false;
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


