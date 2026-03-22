import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { AppContext } from '../../../app/AppContext';
import { BaseAvatarView } from '../BaseAvatarView';
import type { IPlayerAvatarRenderState } from '../IPlayerAvatarRenderState';
import type { IVrmInstance } from '../../../assets/runtime/IVrmAsset';
import { buildNormalizedVrmPose } from './VrmPoseBuilder';

interface IVrmArmNodes {
    upper: THREE.Object3D;
    lower: THREE.Object3D;
    hand: THREE.Object3D;
}

export class VrmAvatarView extends BaseAvatarView {
    private readonly modelRoot: THREE.Group;
    private readonly rawHeadBone: THREE.Object3D | null;
    private readonly leftArmNodes: IVrmArmNodes | null;
    private readonly rightArmNodes: IVrmArmNodes | null;
    private readonly localProxyGroup = new THREE.Group();
    private readonly proxyMaterial: THREE.MeshBasicMaterial;
    private readonly restHipsPosition = new THREE.Vector3();
    private restHeadHeight = 1.6;
    private usingLocalProxy = false;
    private readonly vrmMeshes: THREE.Mesh[] = [];
    private readonly proxyMeshes: THREE.Mesh[] = [];

    constructor(
        context: AppContext,
        private readonly vrmInstance: IVrmInstance,
        {
            color = 0x00ffff,
            isLocal = false
        }: {
            color?: string | number;
            isLocal?: boolean;
        } = {}
    ) {
        const rawHeadBone = vrmInstance.humanoid.getRawBoneNode(VRMHumanBoneName.Head);
        super(context, new THREE.Group(), rawHeadBone || new THREE.Group(), { color, isLocal });

        this.modelRoot = vrmInstance.scene;
        this.modelRoot.scale.setScalar(1);
        this.mesh.add(this.modelRoot);
        this.rawHeadBone = rawHeadBone;
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
    }

    public applyState(state: IPlayerAvatarRenderState, delta: number): void {
        super.applyState(state, delta);

        this.vrmInstance.humanoid.setNormalizedPose(buildNormalizedVrmPose(state.humanoidPose));
        this.updateLocalSelfView();

        if (this.vrmInstance.expressionManager) {
            const audioLevel = this.getAudioLevel();
            // Map the microphone volume directly to the 'Aa' mouth shape
            this.vrmInstance.expressionManager.setValue('aa', Math.min(1.0, audioLevel));
        }

        this.vrmInstance.update(delta);
        this.updateHeadAnchorHeight();
    }

    public setColor(color: string | number): void {
        super.setColor(color);
        const colorObj = new THREE.Color(color as THREE.ColorRepresentation);
        this.proxyMaterial.color.copy(colorObj);
    }

    public destroy(): void {
        super.destroy();
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
        this.mesh.getWorldPosition(this.tmpTargetPos); // Reuse tmpTargetPos as dummy
        const dummyPos = new THREE.Vector3();
        head.getWorldPosition(dummyPos);
        this.restHeadHeight = Math.max(0.6, dummyPos.y - this.tmpTargetPos.y);
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

        const setupSide = (nodes: IVrmArmNodes | null) => {
            if (!nodes) return;
            const upper = new THREE.Mesh(geo, this.proxyMaterial);
            const lower = new THREE.Mesh(geo, this.proxyMaterial);
            const wrist = new THREE.Mesh(wristGeo, this.proxyMaterial);

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
            
            this.vrmInstance.humanoid.setNormalizedPose(currentPose);
        };

        setupSide(this.leftArmNodes);
        setupSide(this.rightArmNodes);
    }

    private updateHeadAnchorHeight(): void {
        if (!this.rawHeadBone) {
            this.currentHeadAnchorY = this.restHeadHeight;
            return;
        }

        const worldPosA = new THREE.Vector3();
        const worldPosB = new THREE.Vector3();
        this.mesh.getWorldPosition(worldPosA);
        this.rawHeadBone.getWorldPosition(worldPosB);
        this.currentHeadAnchorY = Math.max(0.4, worldPosB.y - worldPosA.y);
    }
}


