import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { AppContext } from '../../../app/AppContext';
import { BaseAvatarView } from '../BaseAvatarView';
import type { IPlayerAvatarRenderState } from '../IPlayerAvatarRenderState';
import type { IVrmInstance } from '../../../assets/runtime/IVrmAsset';
import { buildNormalizedVrmPose } from './VrmPoseBuilder';
import type { IAvatarConfig } from '../../../shared/contracts/IAvatar';
import { estimateStandingEyeHeightM } from '../../../shared/avatar/AvatarMetrics';

const VRM_FIRST_PERSON_ONLY_LAYER = 9;
const VRM_THIRD_PERSON_ONLY_LAYER = 10;

export class VrmAvatarView extends BaseAvatarView {
    private readonly modelRoot: THREE.Group;
    private readonly rawHeadBone: THREE.Object3D | null;
    private readonly restHipsPosition = new THREE.Vector3();
    private restHeadHeight = 1.6;
    private playerHeightM = 1.8;
    private usingFirstPersonLayers = false;

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

        this.captureHeadMetrics();
        this.updateModelScale();
        this.setupFirstPerson();
    }

    public applyState(state: IPlayerAvatarRenderState, delta: number): void {
        super.applyState(state, delta);

        this.vrmInstance.humanoid.setNormalizedPose(buildNormalizedVrmPose(state.humanoidPose, {
            metaVersion: this.vrmInstance.metaVersion
        }));
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
    }

    public setAvatarConfig(config: IAvatarConfig): void {
        this.playerHeightM = config.playerHeightM;
        this.updateModelScale();
    }

    public destroy(): void {
        this.setFirstPersonCameraMode(false);
        super.destroy();
        this.vrmInstance.dispose();
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

    private updateModelScale(): void {
        const targetEyeHeight = estimateStandingEyeHeightM(this.playerHeightM);
        const restEyeHeight = Math.max(0.6, this.restHeadHeight);
        // This is only a simple uniform height match using the head bone as an
        // eye-height proxy. It improves first-person scale perception, but it
        // is not a full body calibration or limb-length retargeting solution.
        this.modelRoot.scale.setScalar(targetEyeHeight / restEyeHeight);
    }

    private updateLocalSelfView(): void {
        const isLocalAvatar = !!this.mesh.userData.isLocalAvatar;
        const shouldUseFirstPerson = isLocalAvatar && !!this.vrmInstance.firstPerson;
        this.setFirstPersonCameraMode(shouldUseFirstPerson);
    }

    private setupFirstPerson(): void {
        if (!this.mesh.userData.isLocalAvatar || !this.vrmInstance.firstPerson) {
            return;
        }

        this.vrmInstance.firstPerson.setup({
            firstPersonOnlyLayer: VRM_FIRST_PERSON_ONLY_LAYER,
            thirdPersonOnlyLayer: VRM_THIRD_PERSON_ONLY_LAYER
        });
    }

    private setFirstPersonCameraMode(enabled: boolean): void {
        if (this.usingFirstPersonLayers === enabled) {
            return;
        }

        this.usingFirstPersonLayers = enabled;
        const camera = this.context.runtime.render?.camera;
        if (!camera) {
            return;
        }

        if (enabled) {
            camera.layers.enable(VRM_FIRST_PERSON_ONLY_LAYER);
            camera.layers.disable(VRM_THIRD_PERSON_ONLY_LAYER);
        } else {
            camera.layers.disable(VRM_FIRST_PERSON_ONLY_LAYER);
            camera.layers.enable(VRM_THIRD_PERSON_ONLY_LAYER);
        }
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


