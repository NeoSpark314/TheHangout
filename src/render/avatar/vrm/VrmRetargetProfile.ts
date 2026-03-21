import * as THREE from 'three';
import { VRMHumanBoneName, VRMHumanoid } from '@pixiv/three-vrm';

export interface IVrmArmChainProfile {
    shoulder: THREE.Object3D;
    upper: THREE.Object3D;
    lower: THREE.Object3D;
    hand: THREE.Object3D;
    baseUpperDir: THREE.Vector3;
    baseLowerDir: THREE.Vector3;
    upperLength: number;
    lowerLength: number;
    restUpperQuat: THREE.Quaternion;
    restLowerQuat: THREE.Quaternion;
    restHandQuat: THREE.Quaternion;
    defaultPoleLocal: THREE.Vector3;
}

export class VrmRetargetProfile {
    public readonly normalizedRoot: THREE.Object3D;
    public readonly rawHeadBone: THREE.Object3D | null;
    public readonly hipsBone: THREE.Object3D | null;
    public readonly spineBone: THREE.Object3D | null;
    public readonly chestBone: THREE.Object3D | null;
    public readonly upperChestBone: THREE.Object3D | null;
    public readonly neckBone: THREE.Object3D | null;
    public readonly headBone: THREE.Object3D | null;
    public readonly leftArm: IVrmArmChainProfile | null;
    public readonly rightArm: IVrmArmChainProfile | null;

    constructor(public readonly humanoid: VRMHumanoid) {
        this.normalizedRoot = this.humanoid.normalizedHumanBonesRoot;
        this.rawHeadBone = this.humanoid.getRawBoneNode(VRMHumanBoneName.Head);
        this.hipsBone = this.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
        this.spineBone = this.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
        this.chestBone = this.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest);
        this.upperChestBone = this.humanoid.getNormalizedBoneNode(VRMHumanBoneName.UpperChest);
        this.neckBone = this.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck);
        this.headBone = this.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
        this.leftArm = this.createArmChain('left');
        this.rightArm = this.createArmChain('right');
    }

    private createArmChain(side: 'left' | 'right'): IVrmArmChainProfile | null {
        const shoulder = this.humanoid.getNormalizedBoneNode(
            side === 'left' ? VRMHumanBoneName.LeftShoulder : VRMHumanBoneName.RightShoulder
        );
        const upper = this.humanoid.getNormalizedBoneNode(
            side === 'left' ? VRMHumanBoneName.LeftUpperArm : VRMHumanBoneName.RightUpperArm
        );
        const lower = this.humanoid.getNormalizedBoneNode(
            side === 'left' ? VRMHumanBoneName.LeftLowerArm : VRMHumanBoneName.RightLowerArm
        );
        const hand = this.humanoid.getNormalizedBoneNode(
            side === 'left' ? VRMHumanBoneName.LeftHand : VRMHumanBoneName.RightHand
        );

        if (!shoulder || !upper || !lower || !hand) {
            return null;
        }

        return {
            shoulder,
            upper,
            lower,
            hand,
            baseUpperDir: lower.position.clone().normalize(),
            baseLowerDir: hand.position.clone().normalize(),
            upperLength: Math.max(0.001, lower.position.length()),
            lowerLength: Math.max(0.001, hand.position.length()),
            restUpperQuat: upper.quaternion.clone(),
            restLowerQuat: lower.quaternion.clone(),
            restHandQuat: hand.quaternion.clone(),
            defaultPoleLocal: new THREE.Vector3(side === 'left' ? -1 : 1, 0, 0.35).normalize()
        };
    }
}
