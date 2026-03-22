import * as THREE from 'three';
import type { IScenarioContext, IScenarioStaticBodyHandle } from '../../contracts/IScenarioContext';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IObjectModule } from '../../contracts/IObjectModule';
import type { IScenarioActionProvider } from '../../contracts/IScenarioAction';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';

interface IAssetDef {
    id: string;
    url: string;
    collision?: 'none' | 'box';
}

interface ILayoutElement {
    type: 'instance' | 'area';
    assetId: string;
    position?: { x: number, y: number, z: number };
    rotation?: { x?: number, y?: number, z?: number };
    scale?: number;
    // Area properties
    center?: { x: number, z: number };
    radius?: number;
    innerRadius?: number;
    count?: number;
    randomScale?: [number, number];
    randomRotation?: boolean;
}

interface IScenarioMetadata {
    id: string;
    displayName: string;
    assetKit: {
        baseUrl: string;
        assets: IAssetDef[];
    };
    environment: {
        groundTexture?: string;
        skyColor?: string;
        fogColor?: string;
        fogNear?: number;
        fogFar?: number;
        sunDirection?: { x: number, y: number, z: number };
        sunColor?: string;
        sunIntensity?: number;
        hemiSkyColor?: string;
        hemiGroundColor?: string;
        hemiIntensity?: number;
        castShadows?: boolean;
    };
    layout: ILayoutElement[];
}

export class QuaterniusScenario implements IScenarioModule {
    public id: string = 'quaternius-generic';
    public displayName: string = 'Quaternius World';
    public kind = 'social' as const;
    public maxPlayers = 16;

    private metadata: IScenarioMetadata | null = null;
    private assetCache: Map<string, THREE.Group> = new Map();
    private colliders: IScenarioStaticBodyHandle[] = [];
    private instancedMeshes: THREE.InstancedMesh[] = [];
    private lights: THREE.Light[] = [];
    private root = new THREE.Group();
    private context: IScenarioContext | null = null;
    private previousShadowMapEnabled: boolean | null = null;

    constructor(private readonly configUrl: string) {}

    public async load(context: IScenarioContext, _options: IScenarioLoadOptions): Promise<void> {
        this.context = context;
        
        try {
            const response = await fetch(this.configUrl);
            this.metadata = await response.json();
        } catch (err) {
            console.error('[QuaterniusScenario] Failed to load metadata:', err);
            return;
        }

        if (!this.metadata) return;

        this.id = this.metadata.id;
        this.displayName = this.metadata.displayName;

        // Load ground texture if specified
        if (this.metadata.environment.groundTexture) {
            context.physics.ensureGround();
            // In a real implementation, we'd apply the texture to the ground mesh,
            // but for now we just use the default ground.
        }

        // Apply environment visuals
        const scene = context.scene.getRoot();
        if (scene) {
            if (this.metadata.environment.skyColor) {
                scene.background = new THREE.Color(this.metadata.environment.skyColor);
            }
            if (this.metadata.environment.fogColor) {
                scene.fog = new THREE.Fog(
                    this.metadata.environment.fogColor,
                    this.metadata.environment.fogNear ?? 20,
                    this.metadata.environment.fogFar ?? 100
                );
            }
            scene.add(this.root);
            this.setupLights(scene);
        }

        // Preload assets
        const configDir = this.configUrl.substring(0, this.configUrl.lastIndexOf('/') + 1);
        
        for (const asset of this.metadata.assetKit.assets) {
            let baseUrl = this.metadata.assetKit.baseUrl;
            if (!baseUrl.startsWith('/') && !baseUrl.includes('://')) {
                baseUrl = configDir + baseUrl;
            }
            const fullUrl = baseUrl + asset.url;
            try {
                const model = await context.assets.getNormalizedModel(fullUrl, 1.0);
                this.assetCache.set(asset.id, model);
            } catch (err) {
                console.error(`[QuaterniusScenario] Failed to load asset ${asset.id}:`, err);
            }
        }
        
        // Build layout
        this.buildLayout();
    }

    public unload(_context: IScenarioContext): void {
        this.colliders.forEach(c => c.destroy());
        this.colliders = [];
        this.lights.forEach(l => l.removeFromParent());
        this.lights = [];
        this.instancedMeshes.forEach(im => {
            im.removeFromParent();
            im.geometry.dispose();
            if (Array.isArray(im.material)) im.material.forEach(m => m.dispose());
            else im.material.dispose();
        });
        this.instancedMeshes = [];
        this.root.removeFromParent();
        this.root.clear();
        this.assetCache.clear();

        const renderer = this.context?.scene.getRenderer();
        if (renderer && this.previousShadowMapEnabled !== null) {
            renderer.shadowMap.enabled = this.previousShadowMapEnabled;
        }
    }

    public update(_delta: number): void {
        // No per-frame logic needed for static environment
    }

    public getSpawnPoint(_index: number): IScenarioSpawnPoint {
        return {
            position: { x: 0, y: 0.2, z: 2 },
            yaw: 0
        };
    }

    private buildLayout(): void {
        if (!this.metadata) return;

        interface IInstanceFlat {
            assetId: string;
            position: { x: number, y: number, z: number };
            rotation: { x: number, y: number, z: number };
            scale: number;
        }

        const flatInstances: IInstanceFlat[] = [];

        // Flatten areas and instances
        for (const element of this.metadata.layout) {
            if (element.type === 'instance') {
                const pos = element.position ?? { x: 0, y: 0, z: 0 };
                const rot = element.rotation ? { x: element.rotation.x ?? 0, y: element.rotation.y ?? 0, z: element.rotation.z ?? 0 } : { x: 0, y: 0, z: 0 };
                const scl = element.scale ?? 1.0;
                flatInstances.push({ assetId: element.assetId, position: pos, rotation: rot, scale: scl });
            } else if (element.type === 'area') {
                const count = element.count ?? 10;
                const center = element.center ?? { x: 0, z: 0 };
                const radius = element.radius ?? 10;
                const innerRadius = element.innerRadius ?? 0;

                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = innerRadius + Math.sqrt(Math.random()) * (radius - innerRadius);
                    const x = center.x + Math.cos(angle) * r;
                    const z = center.z + Math.sin(angle) * r;
                    const y = element.position?.y ?? 0;

                    const scale = element.randomScale
                        ? element.randomScale[0] + Math.random() * (element.randomScale[1] - element.randomScale[0])
                        : (element.scale ?? 1.0);

                    const rotationY = element.randomRotation ? Math.random() * Math.PI * 2 : (element.rotation?.y ?? 0);
                    flatInstances.push({
                        assetId: element.assetId,
                        position: { x, y, z },
                        rotation: { x: 0, y: rotationY, z: 0 },
                        scale: scale
                    });
                }
            }
        }

        // Group by assetId
        const groups = new Map<string, IInstanceFlat[]>();
        for (const inst of flatInstances) {
            if (!groups.has(inst.assetId)) groups.set(inst.assetId, []);
            groups.get(inst.assetId)!.push(inst);
        }

        // Processing groups
        for (const [assetId, instances] of groups) {
            const sourceGroup = this.assetCache.get(assetId);
            if (!sourceGroup) continue;

            // Find meshes in the source group
            const meshes: THREE.Mesh[] = [];
            sourceGroup.traverse(child => {
                if ((child as THREE.Mesh).isMesh) {
                    meshes.push(child as THREE.Mesh);
                }
            });

            if (meshes.length === 0) continue;

            const instCount = instances.length;
            const tempMatrix = new THREE.Matrix4();
            const tempEuler = new THREE.Euler();
            const tempPos = new THREE.Vector3();
            const tempQuat = new THREE.Quaternion();
            const tempScale = new THREE.Vector3();

            for (const mesh of meshes) {
                const instMesh = new THREE.InstancedMesh(mesh.geometry, mesh.material, instCount);
                if (this.metadata.environment.castShadows) {
                    instMesh.castShadow = true;
                    instMesh.receiveShadow = true;
                }
                
                // Copy the relative transform from the child mesh to the source group
                const childPos = mesh.position;
                const childQuat = mesh.quaternion;
                const childScale = mesh.scale;

                for (let i = 0; i < instCount; i++) {
                    const inst = instances[i];
                    
                    // Local transform of the instance
                    tempPos.set(inst.position.x, inst.position.y, inst.position.z);
                    tempEuler.set(inst.rotation.x, inst.rotation.y, inst.rotation.z);
                    tempQuat.setFromEuler(tempEuler);
                    tempScale.set(inst.scale, inst.scale, inst.scale);
                    
                    // Combine with the child mesh's local transform relative to the source group
                    tempMatrix.compose(tempPos, tempQuat, tempScale);
                    const childMatrix = new THREE.Matrix4().compose(childPos, childQuat, childScale);
                    tempMatrix.multiply(childMatrix);

                    instMesh.setMatrixAt(i, tempMatrix);

                    // Add collision logic for the first mesh (to avoid duplicate colliders)
                    if (mesh === meshes[0]) {
                        this.addCollision(assetId, inst, tempMatrix);
                    }
                }
                
                instMesh.instanceMatrix.needsUpdate = true;
                this.root.add(instMesh);
                this.instancedMeshes.push(instMesh);
            }
        }
    }

    private addCollision(assetId: string, inst: IInstanceFlat, worldMatrix: THREE.Matrix4): void {
        const assetDef = this.metadata?.assetKit.assets.find(a => a.id === assetId);
        if (assetDef?.collision === 'box' && this.context) {
            // Use the source group bounds for collision
            const source = this.assetCache.get(assetId);
            if (!source) return;

            const box = new THREE.Box3().setFromObject(source);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            // Transform center to world space
            const worldCenter = center.applyMatrix4(worldMatrix);
            const worldQuat = new THREE.Quaternion().setFromRotationMatrix(worldMatrix);

            const collider = this.context.physics.createStaticBox({
                position: { x: worldCenter.x, y: worldCenter.y, z: worldCenter.z },
                halfExtents: { x: size.x * inst.scale / 2, y: size.y * inst.scale / 2, z: size.z * inst.scale / 2 },
                rotation: { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }
            });
            if (collider) this.colliders.push(collider);
        }
    }

    private setupLights(scene: THREE.Scene): void {
        if (!this.metadata) return;
        const env = this.metadata.environment;

        // Hemisphere Light
        const hemi = new THREE.HemisphereLight(
            env.hemiSkyColor ?? 0xffffff,
            env.hemiGroundColor ?? 0x444444,
            env.hemiIntensity ?? 0.6
        );
        scene.add(hemi);
        this.lights.push(hemi);

        // Directional Light (Sun)
        const sun = new THREE.DirectionalLight(
            env.sunColor ?? 0xffffff,
            env.sunIntensity ?? 1.0
        );
        const sunDir = env.sunDirection ?? { x: 5, y: 10, z: 2 };
        sun.position.set(sunDir.x, sunDir.y, sunDir.z);
        
        if (env.castShadows) {
            sun.castShadow = true;
            sun.shadow.mapSize.set(2048, 2048);
            sun.shadow.camera.near = 0.5;
            sun.shadow.camera.far = 100;
            sun.shadow.camera.left = -50;
            sun.shadow.camera.right = 50;
            sun.shadow.camera.top = 50;
            sun.shadow.camera.bottom = -50;

            const renderer = this.context?.scene.getRenderer();
            if (renderer) {
                this.previousShadowMapEnabled = renderer.shadowMap.enabled;
                renderer.shadowMap.enabled = true;
                renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            }
        }
        
        scene.add(sun);
        this.lights.push(sun);
    }
}

export const QuaterniusNatureScenarioPlugin: IScenarioPlugin = {
    id: 'quaternius-nature',
    displayName: 'Quaternius Nature',
    kind: 'social',
    maxPlayers: 16,
    capabilities: {
        headless: true,
        usesPhysics: true,
        usesAudio: true,
        hasActions: false,
        hasPortableObjects: true
    },
    create() {
        return new QuaterniusScenario('/scenarios/quaternius/nature_park.json');
    }
};
