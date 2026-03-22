import * as THREE from 'three';
import type { IScenarioContext, IScenarioStaticBodyHandle } from '../../contracts/IScenarioContext';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IObjectModule } from '../../contracts/IObjectModule';
import type { IScenarioActionProvider } from '../../contracts/IScenarioAction';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import { applyWindSway } from '../../../render/utils/WindShader';
import type { IUniform } from 'three';

interface IInstanceFlat {
    assetId: string;
    position: { x: number, y: number, z: number };
    rotation: { x: number, y: number, z: number };
    scale: number;
}

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
    terrain?: {
        size?: [number, number];
        resolution?: [number, number];
        height?: number;
        seed?: number;
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
    private terrainMesh: THREE.Mesh | null = null;
    private terrainHeights: Float32Array | null = null;
    private terrainBody: IScenarioStaticBodyHandle | null = null;
    private lights: THREE.Light[] = [];
    private root = new THREE.Group();
    private context: IScenarioContext | null = null;
    private previousShadowMapEnabled: boolean | null = null;
    private isUnloaded = false;

    constructor(private readonly configUrl: string) {}

    public async load(context: IScenarioContext, options: IScenarioLoadOptions): Promise<void> {
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

        // Use session seed if provided, fallback to config seed, then 42
        const seed = options.seed ?? this.metadata.terrain?.seed ?? 42;

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
                    this.metadata.environment.fogColor ?? '#ffffff',
                    this.metadata.environment.fogNear ?? 1,
                    this.metadata.environment.fogFar ?? 1000
                );
            }

            if (this.metadata.terrain) {
                this.generateTerrain(scene, seed);
            } else {
                context.physics.ensureGround();
            }

            scene.add(this.root);
            this.setupLights(scene);
        }

        // Preload assets
        const configDir = this.configUrl.substring(0, this.configUrl.lastIndexOf('/') + 1);
        
        const promises = this.metadata.assetKit.assets.map(async (assetDef) => {
            if (this.isUnloaded) return;
            let baseUrl = this.metadata.assetKit.baseUrl;
            if (!baseUrl.startsWith('/') && !baseUrl.includes('://')) {
                baseUrl = configDir + baseUrl;
            }
            const fullUrl = baseUrl + assetDef.url;
            try {
                const model = await this.context!.assets.loadGLTF(fullUrl);
                this.assetCache.set(assetDef.id, model);
            } catch (err) {
                console.error(`[QuaterniusScenario] Failed to load asset ${assetDef.id}:`, err);
            }
        });
        await Promise.all(promises);
        
        if (this.isUnloaded) return;

        // Build layout
        this.buildLayout(seed);
    }

    public unload(_context: IScenarioContext): void {
        this.isUnloaded = true;
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
        this.terrainMesh?.removeFromParent();
        this.terrainMesh?.geometry.dispose();
        if (this.terrainMesh?.material) {
            if (Array.isArray(this.terrainMesh.material)) this.terrainMesh.material.forEach(m => m.dispose());
            else this.terrainMesh.material.dispose();
        }
        this.terrainMesh = null;
        this.terrainHeights = null;
        if (this.terrainBody) {
            _context.physics.removeBody(this.terrainBody);
            this.terrainBody = null;
        }
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

    private buildLayout(seed: number): void {
        if (!this.metadata) return;

        const flatInstances: IInstanceFlat[] = [];
        const rng = new SimplePNoise(seed); // Deterministic RNG for layout

        // Flatten areas and instances
        for (const element of this.metadata.layout) {
            if (element.type === 'instance') {
                const x = element.position?.x ?? 0;
                const z = element.position?.z ?? 0;
                const h = this.getHeight(x, z);
                const pos = { x, y: (element.position?.y ?? 0) + h, z };
                
                const rot = element.rotation ? { x: element.rotation.x ?? 0, y: element.rotation.y ?? 0, z: element.rotation.z ?? 0 } : { x: 0, y: 0, z: 0 };
                const scl = element.scale ?? 1.0;
                flatInstances.push({ assetId: element.assetId, position: pos, rotation: rot, scale: scl });
            } else if (element.type === 'area') {
                const count = element.count ?? 10;
                const center = element.center ?? { x: 0, z: 0 };
                const radius = element.radius ?? 10;
                const innerRadius = element.innerRadius ?? 0;

                for (let i = 0; i < count; i++) {
                    const angle = rng.nextFloat() * Math.PI * 2; // Use rng
                    const r = innerRadius + Math.sqrt(rng.nextFloat()) * (radius - innerRadius); // Use rng
                    const x = center.x + Math.cos(angle) * r;
                    const z = center.z + Math.sin(angle) * r;
                    
                    const h = this.getHeight(x, z);
                    const y = (element.position?.y ?? 0) + h;

                    const scale = element.randomScale
                        ? element.randomScale[0] + rng.nextFloat() * (element.randomScale[1] - element.randomScale[0]) // Use rng
                        : (element.scale ?? 1.0);

                    const rotationY = element.randomRotation ? rng.nextFloat() * Math.PI * 2 : (element.rotation?.y ?? 0); // Use rng
                    
                    // Simple clearance check for the spawn area (0, 0, 2)
                    const spawnPos = { x: 0, z: 2 }; 
                    const clearanceRadius = 6.0;
                    const dx = x - spawnPos.x;
                    const dz = z - spawnPos.z;
                    const distToSpawn = Math.sqrt(dx * dx + dz * dz);

                    // Skip larger objects if they are too close to the player spawn point
                    const isLarge = element.assetId.includes('tree') || element.assetId.includes('pine') || element.assetId.includes('rock');
                    if (isLarge && distToSpawn < clearanceRadius) {
                        continue;
                    }

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

            // Ensure matrices are computed down the tree hierarchy
            sourceGroup.updateMatrixWorld(true);

            for (const mesh of meshes) {
                const instMesh = new THREE.InstancedMesh(mesh.geometry, mesh.material, instCount);
                if (this.metadata.environment.castShadows) {
                    instMesh.castShadow = true;
                    instMesh.receiveShadow = true;
                }
                
                // Get the mesh's full transform (incorporates deep node hierarchy from optimized GLTFs)
                const childMatrix = mesh.matrixWorld;

                for (let i = 0; i < instCount; i++) {
                    const inst = instances[i];
                    
                    // Local transform of the instance
                    tempPos.set(inst.position.x, inst.position.y, inst.position.z);
                    tempEuler.set(inst.rotation.x, inst.rotation.y, inst.rotation.z);
                    tempQuat.setFromEuler(tempEuler);
                    tempScale.set(inst.scale, inst.scale, inst.scale);
                    
                    // Combine instance placement with the full computed child matrix
                    tempMatrix.compose(tempPos, tempQuat, tempScale).multiply(childMatrix);

                    instMesh.setMatrixAt(i, tempMatrix);

                    // Add collision logic for the first mesh (to avoid duplicate colliders)
                    if (mesh === meshes[0]) {
                        this.addCollision(assetId, inst, tempMatrix);
                    }
                }
                
                instMesh.instanceMatrix.needsUpdate = true;
                
                // Apply wind sway if it's a nature asset
                const uniforms = this.context?.scene.getGlobalUniforms();
                const globalTime = uniforms?.uTime as IUniform;

                if (globalTime) {
                    const isTree = assetId.includes('tree') || assetId.includes('pine');
                    const isFoliage = assetId.includes('grass') || assetId.includes('flower') || assetId.includes('bush');
                    if (isTree) {
                        applyWindSway(instMesh.material as THREE.Material, { uTime: globalTime, speed: 0.8, amplitude: 0.1 });
                    } else if (isFoliage) {
                        applyWindSway(instMesh.material as THREE.Material, { uTime: globalTime, speed: 1.5, amplitude: 0.2 });
                    }
                }

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

    private generateTerrain(scene: THREE.Scene, seed: number): void {
        if (!this.metadata?.terrain || !this.context) return;
        const config = this.metadata.terrain;

        const width = config.size?.[0] ?? 100;
        const depth = config.size?.[1] ?? 100;
        // Diagnostic: Use a slightly lower resolution (32x32) to rule out size issues
        const resX = config.resolution?.[0] ?? 32;
        const resZ = config.resolution?.[1] ?? 32;
        const maxHeight = config.height ?? 10;

        // Generate Heightfield for Physics
        // Row-Major order: Z is rows, X is columns.
        const numPointsX = resX + 1;
        const numPointsZ = resZ + 1;
        const heights = new Float32Array(numPointsX * numPointsZ);
        const noise = new SimplePNoise(seed); // Use provided seed

        for (let zIdx = 0; zIdx < numPointsZ; zIdx++) {
            for (let xIdx = 0; xIdx < numPointsX; xIdx++) {
                const x = (xIdx / resX - 0.5) * width;
                const z = (zIdx / resZ - 0.5) * depth;
                
                // Fractal noise
                let h = noise.noise(x * 0.05, z * 0.05) * maxHeight;
                h += noise.noise(x * 0.1, z * 0.1) * maxHeight * 0.3;
                h += noise.noise(x * 0.2, z * 0.2) * maxHeight * 0.1;
                
                // Flatten the center area slightly
                const distToCenter = Math.sqrt(x * x + z * z);
                if (distToCenter < 10) {
                    h *= (distToCenter / 10);
                }

                // Guard against NaN and ensure non-negative (some engines prefer it)
                if (isNaN(h)) h = 0;
                h = Math.max(0, h);

                // Row-major: row = Z, col = X
                heights[zIdx * numPointsX + xIdx] = h;
            }
        }
        
        this.terrainHeights = heights;

        console.log(`[QuaterniusScenario] Creating Heightfield: ${resX}x${resZ} subdivisions, heights points: ${numPointsX}x${numPointsZ}, total elements: ${heights.length}`);

        this.terrainBody = this.context.physics.createStaticHeightfield({
            nrows: resX, // Subdivisions along X (standard Rapier)
            ncols: resZ, // Subdivisions along Z (standard Rapier)
            heights,
            // In Rapier 0.19, scale is the full dimension of the heightfield
            scale: { x: width, y: 1.0, z: depth }
        });
        
        // Ensure grounding happens at the end to place player on NEW surface
        const localPlayer = this.context.players.getLocal();
        if (localPlayer) {
            this.context.players.teleport(localPlayer.id, { x: 0, y: 5, z: 0 }, 0);
        }

        // Generate Visual Mesh
        const geometry = new THREE.PlaneGeometry(width, depth, resX, resZ);
        geometry.rotateX(-Math.PI / 2);

        const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
        const colors: number[] = [];
        
        const grassColor = new THREE.Color('#4d7c32');
        const rockColor = new THREE.Color('#7a7a7a');
        const sandColor = new THREE.Color('#d2b48c');

        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const z = posAttr.getZ(i);
            
            // Find height from our array
            const xIdx = Math.round((x / width + 0.5) * resX);
            const zIdx = Math.round((z / depth + 0.5) * resZ);
            const h = heights[zIdx * numPointsX + xIdx];
            
            posAttr.setY(i, h);

            // Coloring based on height and slope
            if (h < 0.5) {
                colors.push(sandColor.r, sandColor.g, sandColor.b);
            } else if (h > maxHeight * 0.6) {
                colors.push(rockColor.r, rockColor.g, rockColor.b);
            } else {
                colors.push(grassColor.r, grassColor.g, grassColor.b);
            }
        }

        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        // Convert to non-indexed for a faceted low-poly look
        const facetedGeometry = geometry.toNonIndexed();
        facetedGeometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: true,
            roughness: 0.8,
            metalness: 0.1
        });

        this.terrainMesh = new THREE.Mesh(facetedGeometry, material);
        this.terrainMesh.receiveShadow = true;
        scene.add(this.terrainMesh);
    }

    private getHeight(x: number, z: number): number {
        if (!this.metadata?.terrain || !this.terrainHeights) return 0;
        const config = this.metadata.terrain;
        const width = config.size?.[0] ?? 100;
        const depth = config.size?.[1] ?? 100;
        const resX = config.resolution?.[0] ?? 64;
        const resZ = config.resolution?.[1] ?? 64;

        // Convert to grid-relative coords [0, res]
        const gx = (x / width + 0.5) * resX;
        const gz = (z / depth + 0.5) * resZ;

        if (gx < 0 || gx >= resX || gz < 0 || gz >= resZ) return 0;

        const ix = Math.floor(gx);
        const iz = Math.floor(gz);
        const fx = gx - ix;
        const fz = gz - iz;

        const numPointsX = resX + 1;
        const h00 = this.terrainHeights[iz * numPointsX + ix];
        const h10 = this.terrainHeights[iz * numPointsX + (ix + 1)];
        const h01 = this.terrainHeights[(iz + 1) * numPointsX + ix];
        const h11 = this.terrainHeights[(iz + 1) * numPointsX + (ix + 1)];

        // Bilinear interpolation
        return (1 - fz) * ((1 - fx) * h00 + fx * h10) + fz * ((1 - fx) * h01 + fx * h11);
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

class SimplePNoise {
    private p: number[] = [];
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
        for (let i = 0; i < 256; i++) this.p[i] = i;
        // Pseudo-random shuffle based on seed
        let s = seed;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807) % 2147483647;
            const j = s % (i + 1);
            [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
        }
        this.p = [...this.p, ...this.p];
    }

    public nextFloat(): number {
        this.seed = (this.seed * 16807) % 2147483647;
        return (this.seed - 1) / 2147483646;
    }

    private fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
    private lerp(t: number, a: number, b: number) { return a + t * (b - a); }
    private grad(hash: number, x: number, y: number) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    public noise(x: number, y: number) {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const X = xi & 255;
        const Y = yi & 255;
        const xf = x - xi;
        const yf = y - yi;
        const u = this.fade(xf);
        const v = this.fade(yf);

        const aa = this.p[this.p[X] + Y];
        const ab = this.p[this.p[X] + Y + 1];
        const ba = this.p[this.p[X + 1] + Y];
        const bb = this.p[this.p[X + 1] + Y + 1];

        return this.lerp(v,
            this.lerp(u, this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf)),
            this.lerp(u, this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1))
        );
    }
}
