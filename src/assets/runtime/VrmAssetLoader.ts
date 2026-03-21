import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
    VRM,
    VRMHumanBoneName,
    VRMHumanoid,
    VRMLoaderPlugin,
    VRMUtils
} from '@pixiv/three-vrm';
import type { IVrmInstance, IVrmTemplate } from './IVrmAsset';

const VRM_BONE_NAMES: VRMHumanBoneName[] = [
    VRMHumanBoneName.Hips,
    VRMHumanBoneName.Spine,
    VRMHumanBoneName.Chest,
    VRMHumanBoneName.UpperChest,
    VRMHumanBoneName.Neck,
    VRMHumanBoneName.Head,
    VRMHumanBoneName.LeftShoulder,
    VRMHumanBoneName.LeftUpperArm,
    VRMHumanBoneName.LeftLowerArm,
    VRMHumanBoneName.LeftHand,
    VRMHumanBoneName.RightShoulder,
    VRMHumanBoneName.RightUpperArm,
    VRMHumanBoneName.RightLowerArm,
    VRMHumanBoneName.RightHand,
    VRMHumanBoneName.LeftUpperLeg,
    VRMHumanBoneName.LeftLowerLeg,
    VRMHumanBoneName.LeftFoot,
    VRMHumanBoneName.RightUpperLeg,
    VRMHumanBoneName.RightLowerLeg,
    VRMHumanBoneName.RightFoot,
    VRMHumanBoneName.LeftThumbMetacarpal,
    VRMHumanBoneName.LeftThumbProximal,
    VRMHumanBoneName.LeftThumbDistal,
    VRMHumanBoneName.LeftIndexProximal,
    VRMHumanBoneName.LeftIndexIntermediate,
    VRMHumanBoneName.LeftIndexDistal,
    VRMHumanBoneName.LeftMiddleProximal,
    VRMHumanBoneName.LeftMiddleIntermediate,
    VRMHumanBoneName.LeftMiddleDistal,
    VRMHumanBoneName.LeftRingProximal,
    VRMHumanBoneName.LeftRingIntermediate,
    VRMHumanBoneName.LeftRingDistal,
    VRMHumanBoneName.LeftLittleProximal,
    VRMHumanBoneName.LeftLittleIntermediate,
    VRMHumanBoneName.LeftLittleDistal,
    VRMHumanBoneName.RightThumbMetacarpal,
    VRMHumanBoneName.RightThumbProximal,
    VRMHumanBoneName.RightThumbDistal,
    VRMHumanBoneName.RightIndexProximal,
    VRMHumanBoneName.RightIndexIntermediate,
    VRMHumanBoneName.RightIndexDistal,
    VRMHumanBoneName.RightMiddleProximal,
    VRMHumanBoneName.RightMiddleIntermediate,
    VRMHumanBoneName.RightMiddleDistal,
    VRMHumanBoneName.RightRingProximal,
    VRMHumanBoneName.RightRingIntermediate,
    VRMHumanBoneName.RightRingDistal,
    VRMHumanBoneName.RightLittleProximal,
    VRMHumanBoneName.RightLittleIntermediate,
    VRMHumanBoneName.RightLittleDistal
];

class VrmTemplate implements IVrmTemplate {
    private readonly normalizedBoneNames = new Map<VRMHumanBoneName, string>();

    constructor(private readonly vrm: VRM) {
        for (const boneName of VRM_BONE_NAMES) {
            const node = this.vrm.humanoid.getNormalizedBoneNode(boneName);
            if (node?.name) {
                this.normalizedBoneNames.set(boneName, node.name);
            }
        }
    }

    public createInstance(): IVrmInstance {
        const clonedScene = cloneSkeleton(this.vrm.scene) as THREE.Group;
        clonedScene.updateMatrixWorld(true);

        const humanoid = this.buildHumanoidForClone(clonedScene);
        const firstPerson = this.vrm.firstPerson ?? null;
        const metaVersion = this.vrm.meta?.metaVersion ?? null;

        return {
            scene: clonedScene,
            humanoid,
            firstPerson,
            metaVersion,
            update: (_delta: number) => {
                humanoid.update();
            },
            dispose: () => {
                VRMUtils.deepDispose(clonedScene);
            }
        };
    }

    private buildHumanoidForClone(scene: THREE.Group): VRMHumanoid {
        const humanBones: Partial<Record<VRMHumanBoneName, { node: THREE.Object3D }>> = {};
        for (const boneName of VRM_BONE_NAMES) {
            const originalName = this.normalizedBoneNames.get(boneName);
            if (!originalName) continue;
            const cloneBone = scene.getObjectByName(originalName);
            if (cloneBone) {
                humanBones[boneName] = { node: cloneBone };
            }
        }

        return new VRMHumanoid(humanBones as any);
    }
}

let vrmLoader: GLTFLoader | null = null;

function getVrmLoader(): GLTFLoader {
    if (vrmLoader) return vrmLoader;

    vrmLoader = new GLTFLoader();
    vrmLoader.register((parser) => new VRMLoaderPlugin(parser));
    return vrmLoader;
}

export async function loadVrmTemplate(url: string): Promise<IVrmTemplate> {
    const loader = getVrmLoader();

    return new Promise<IVrmTemplate>((resolve, reject) => {
        loader.load(url, (gltf: GLTF) => {
            const vrm = gltf.userData.vrm as VRM | undefined;
            if (!vrm) {
                reject(new Error(`No VRM payload found in ${url}`));
                return;
            }

            VRMUtils.removeUnnecessaryVertices(vrm.scene);
            VRMUtils.combineSkeletons(vrm.scene);
            if (vrm.meta?.metaVersion === '0') {
                VRMUtils.rotateVRM0(vrm);
            }
            vrm.lookAt?.reset();
            resolve(new VrmTemplate(vrm));
        }, undefined, (error) => reject(error));
    });
}
