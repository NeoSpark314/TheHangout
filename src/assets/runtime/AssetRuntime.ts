import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { IVrmInstance, IVrmTemplate } from './IVrmAsset';

import { AppContext } from '../../app/AppContext';

/**
 * Service for loading and caching 3D assets and textures.
 */
export class AssetRuntime {
    private loader = new GLTFLoader();
    private ktx2Loader: KTX2Loader | null = null;
    private textureLoader = new THREE.TextureLoader();
    private cache: Map<string, THREE.Group> = new Map();
    private loadingPromises: Map<string, Promise<THREE.Group>> = new Map();
    private textureCache: Map<string, THREE.Texture> = new Map();
    private texturePromises: Map<string, Promise<THREE.Texture>> = new Map();
    private vrmCache: Map<string, IVrmTemplate> = new Map();
    private vrmLoadingPromises: Map<string, Promise<IVrmTemplate>> = new Map();

    constructor(private context: AppContext) {
        this.loader.setMeshoptDecoder(MeshoptDecoder);
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

        this.ensureKTX2Loader();

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
                const promise = import('./VrmAssetLoader').then((module) => module.loadVrmTemplate(url));

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

    private ensureKTX2Loader(): void {
        if (!this.ktx2Loader) {
            const renderer = this.context.runtime.render?.renderer;
            if (renderer) {
                this.ktx2Loader = new KTX2Loader()
                    .setTranscoderPath('/basis/')
                    .detectSupport(renderer);
                this.loader.setKTX2Loader(this.ktx2Loader);
            } else {
                console.warn('[AssetRuntime] WebGLRenderer not available yet; cannot initialize KTX2Loader.');
            }
        }
    }
}
