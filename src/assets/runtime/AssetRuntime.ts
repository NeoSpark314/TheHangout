import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
    VRM,
    VRMFirstPerson,
    VRMHumanBoneName,
    VRMHumanoid,
    VRMLoaderPlugin,
    VRMUtils
} from '@pixiv/three-vrm';

import { AppContext } from '../../app/AppContext';

export interface IVrmInstance {
    readonly scene: THREE.Group;
    readonly humanoid: VRMHumanoid;
    readonly firstPerson: VRMFirstPerson | null;
    readonly metaVersion: string | null;
    update(delta: number): void;
    dispose(): void;
}

interface IVrmTemplate {
    createInstance(): IVrmInstance;
}

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
            update: (delta: number) => {
                humanoid.update();
                if (firstPerson) {
                    void delta;
                }
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

/**
 * Service for loading and caching 3D assets and textures.
 */
export class AssetRuntime {
    private loader = new GLTFLoader();
    private vrmLoader = new GLTFLoader();
    private textureLoader = new THREE.TextureLoader();
    private cache: Map<string, THREE.Group> = new Map();
    private loadingPromises: Map<string, Promise<THREE.Group>> = new Map();
    private textureCache: Map<string, THREE.Texture> = new Map();
    private texturePromises: Map<string, Promise<THREE.Texture>> = new Map();
    private vrmCache: Map<string, IVrmTemplate> = new Map();
    private vrmLoadingPromises: Map<string, Promise<IVrmTemplate>> = new Map();

    constructor(private context: AppContext) {
        this.vrmLoader.register((parser) => new VRMLoaderPlugin(parser));
    }

    public async loadTexture(url: string): Promise<THREE.Texture> {
        if (this.textureCache.has(url)) {
            return this.textureCache.get(url)!;
        }

        if (this.texturePromises.has(url)) {
            return this.texturePromises.get(url)!;
        }

        const promise = new Promise<THREE.Texture>((resolve, reject) => {
            this.textureLoader.load(url,
                (texture) => {
                    this.textureCache.set(url, texture);
                    resolve(texture);
                },
                undefined,
                (error) => reject(error)
            );
        });

        this.texturePromises.set(url, promise);
        const result = await promise;
        this.texturePromises.delete(url);

        return result;
    }

    public async loadGLTF(url: string): Promise<THREE.Group> {
        if (this.cache.has(url)) {
            return this.cache.get(url)!.clone();
        }

        if (this.loadingPromises.has(url)) {
            const group = await this.loadingPromises.get(url);
            return group!.clone();
        }

        const promise = new Promise<THREE.Group>((resolve, reject) => {
            this.loader.load(url,
                (gltf) => {
                    this.cache.set(url, gltf.scene);
                    resolve(gltf.scene);
                },
                undefined,
                (error) => reject(error)
            );
        });

        this.loadingPromises.set(url, promise);
        const result = await promise;
        this.loadingPromises.delete(url);

        return result.clone();
    }

    public async loadVRM(url: string): Promise<IVrmInstance> {
        let template = this.vrmCache.get(url);
        if (!template) {
            const inFlight = this.vrmLoadingPromises.get(url);
            if (inFlight) {
                template = await inFlight;
            } else {
                const promise = new Promise<IVrmTemplate>((resolve, reject) => {
                    this.vrmLoader.load(url, (gltf) => {
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

                this.vrmLoadingPromises.set(url, promise);
                template = await promise;
                this.vrmLoadingPromises.delete(url);
                this.vrmCache.set(url, template);
            }
        }

        return template.createInstance();
    }

    /**
     * Helper to get a normalized mesh from a loaded GLTF
     */
    public async getNormalizedModel(url: string, targetSize: number = 1.0): Promise<THREE.Group> {
        const model = await this.loadGLTF(url);

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        const scale = targetSize / maxDim;
        model.scale.setScalar(scale);

        const center = box.getCenter(new THREE.Vector3()).multiplyScalar(-scale);
        model.position.copy(center);

        return model;
    }
}
