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

class VrmTemplate implements IVrmTemplate {
    private readonly rawBoneNames = new Map<VRMHumanBoneName, string>();
    private readonly normalizedRigRootName: string | null;

    constructor(private readonly vrm: VRM) {
        this.normalizedRigRootName = this.vrm.humanoid.normalizedHumanBonesRoot.name || null;
        for (const [boneName, boneNode] of Object.entries(this.vrm.humanoid.humanBones) as Array<[VRMHumanBoneName, { node: THREE.Object3D }]>) {
            if (boneNode?.node?.name) {
                this.rawBoneNames.set(boneName, boneNode.node.name);
            }
        }
    }

    public createInstance(): IVrmInstance {
        const clonedScene = cloneSkeleton(this.vrm.scene) as THREE.Group;
        if (this.normalizedRigRootName) {
            clonedScene.getObjectByName(this.normalizedRigRootName)?.removeFromParent();
        }
        clonedScene.updateMatrixWorld(true);

        const humanoid = this.buildHumanoidForClone(clonedScene);
        clonedScene.add(humanoid.normalizedHumanBonesRoot);
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
        for (const [boneName, originalName] of this.rawBoneNames) {
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
