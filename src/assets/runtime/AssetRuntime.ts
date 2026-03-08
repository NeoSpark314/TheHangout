import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { AppContext } from '../../app/AppContext';

/**
 * Service for loading and caching 3D assets and textures.
 */
export class AssetRuntime {
    private loader = new GLTFLoader();
    private textureLoader = new THREE.TextureLoader();
    private cache: Map<string, THREE.Group> = new Map();
    private loadingPromises: Map<string, Promise<THREE.Group>> = new Map();
    private textureCache: Map<string, THREE.Texture> = new Map();
    private texturePromises: Map<string, Promise<THREE.Texture>> = new Map();

    constructor(private context: AppContext) { }

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
