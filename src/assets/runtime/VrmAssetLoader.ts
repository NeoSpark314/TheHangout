import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    VRM,
    VRMLoaderPlugin,
    VRMUtils
} from '@pixiv/three-vrm';
import type { IVrmInstance, IVrmTemplate } from './IVrmAsset';

class VrmTemplate implements IVrmTemplate {
    constructor(private readonly buffer: ArrayBuffer, private readonly url: string) {}

    public async createInstance(): Promise<IVrmInstance> {
        const loader = getVrmLoader();
        return new Promise<IVrmInstance>((resolve, reject) => {
            loader.parse(this.buffer, this.url, (gltf: GLTF) => {
                const vrm = gltf.userData.vrm as VRM | undefined;
                if (!vrm) {
                    reject(new Error(`No VRM payload found in ${this.url}`));
                    return;
                }

                VRMUtils.removeUnnecessaryVertices(vrm.scene);
                VRMUtils.combineSkeletons(vrm.scene);
                if (vrm.meta?.metaVersion === '0') {
                    VRMUtils.rotateVRM0(vrm);
                }
                vrm.lookAt?.reset();

                resolve({
                    scene: vrm.scene,
                    humanoid: vrm.humanoid,
                    firstPerson: vrm.firstPerson ?? null,
                    metaVersion: vrm.meta?.metaVersion ?? null,
                    expressionManager: vrm.expressionManager ?? null,
                    update: (delta: number) => {
                        vrm.update(delta);
                    },
                    dispose: () => {
                        VRMUtils.deepDispose(vrm.scene);
                    }
                });
            }, (error) => reject(new Error(String(error))));
        });
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
    const fileLoader = new THREE.FileLoader();
    fileLoader.setResponseType('arraybuffer');

    return new Promise<IVrmTemplate>((resolve, reject) => {
        fileLoader.load(url, (data) => {
            resolve(new VrmTemplate(data as ArrayBuffer, url));
        }, undefined, (error) => reject(error));
    });
}
