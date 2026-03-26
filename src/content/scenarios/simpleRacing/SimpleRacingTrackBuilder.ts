import * as THREE from 'three';
import type { IScenarioContext, IScenarioStaticBodyHandle } from '../../contracts/IScenarioContext';
import { SIMPLE_RACING_ASSETS, type TSimpleRacingModelKey } from './SimpleRacingAssets';
import {
    SIMPLE_RACING_CELL,
    SIMPLE_RACING_CELL_RAW,
    SIMPLE_RACING_GRID_SCALE,
    SIMPLE_RACING_ORIENT_DEG,
    SIMPLE_RACING_TRACK_CELLS,
    type TSimpleRacingCell
} from './SimpleRacingTrackData';

type TLoadedModels = Partial<Record<TSimpleRacingModelKey, THREE.Group>>;

const TRACK_MODEL_BY_PIECE: Record<TSimpleRacingCell[2], TSimpleRacingModelKey> = {
    'track-straight': 'trackStraight',
    'track-corner': 'trackCorner',
    'track-bump': 'trackBump',
    'track-finish': 'trackFinish'
};
const TRACK_WALL_MATERIAL = {
    friction: 0.0,
    restitution: 0.0,
    frictionCombineRule: 'min'
} as const;

export class SimpleRacingTrackBuilder {
    private readonly root = new THREE.Group();
    private readonly gameplayBodies: IScenarioStaticBodyHandle[] = [];
    private readonly loadedModels: TLoadedModels = {};
    private sunLight: THREE.DirectionalLight | null = null;
    private hemiLight: THREE.HemisphereLight | null = null;
    private previousShadowMapEnabled: boolean | null = null;
    private previousShadowMapType: THREE.ShadowMapType | null = null;
    private previousShadowMapAutoUpdate: boolean | null = null;
    private previousBackground: THREE.Color | THREE.Texture | null = null;
    private previousFog: THREE.Fog | THREE.FogExp2 | null = null;
    private disposed = false;
    private visualsLoaded = false;

    constructor() {
        this.root.name = 'simple-racing-track';
    }

    public loadWorld(context: IScenarioContext): void {
        this.disposed = false;
        context.physics.ensureGround();
        this.createGameplayColliders(context);
    }

    public loadVisuals(context: IScenarioContext): void {
        this.loadVisualAssets(context).catch((error) => {
            console.error('[SimpleRacingTrackBuilder] Failed to load visuals:', error);
        });
    }

    public unloadVisuals(context: IScenarioContext): void {
        const scene = context.scene.getRoot();
        if (scene) {
            scene.background = this.previousBackground;
            scene.fog = this.previousFog;
        }

        const renderer = context.scene.getRenderer();
        if (renderer && this.previousShadowMapEnabled !== null) {
            renderer.shadowMap.enabled = this.previousShadowMapEnabled;
        }
        if (renderer && this.previousShadowMapType !== null) {
            renderer.shadowMap.type = this.previousShadowMapType;
        }
        if (renderer && this.previousShadowMapAutoUpdate !== null) {
            renderer.shadowMap.autoUpdate = this.previousShadowMapAutoUpdate;
            renderer.shadowMap.needsUpdate = true;
        }

        if (this.sunLight?.parent) {
            this.sunLight.removeFromParent();
        }
        if (this.sunLight?.target.parent) {
            this.sunLight.target.removeFromParent();
        }
        if (this.hemiLight?.parent) {
            this.hemiLight.removeFromParent();
        }
        this.sunLight = null;
        this.hemiLight = null;
        this.previousBackground = null;
        this.previousFog = null;
        this.previousShadowMapEnabled = null;
        this.previousShadowMapType = null;
        this.previousShadowMapAutoUpdate = null;

        context.scene.remove(this.root);
        this.root.clear();
        this.visualsLoaded = false;
    }

    public unloadWorld(_context: IScenarioContext): void {
        this.disposed = true;
        while (this.gameplayBodies.length > 0) {
            this.gameplayBodies.pop()?.destroy();
        }
    }

    private async loadVisualAssets(context: IScenarioContext): Promise<void> {
        if (this.visualsLoaded || this.disposed) return;

        const modelEntries = Object.entries(SIMPLE_RACING_ASSETS.models) as Array<[TSimpleRacingModelKey, string]>;
        const loaded = await Promise.all(modelEntries.map(async ([key, url]) => [key, await context.assets.loadGLTF(url)] as const));
        if (this.disposed) return;

        for (const [key, model] of loaded) {
            this.loadedModels[key] = model;
        }

        this.applyEnvironment(context);
        this.root.position.y = -0.5;
        this.buildTrackVisuals();
        this.buildDecorationVisuals();
        this.root.scale.setScalar(SIMPLE_RACING_GRID_SCALE);
        context.scene.add(this.root);
        this.freezeShadowMap(context);
        this.visualsLoaded = true;
    }

    private applyEnvironment(context: IScenarioContext): void {
        const scene = context.scene.getRoot();
        if (!scene) return;

        this.previousBackground = scene.background as THREE.Color | THREE.Texture | null;
        this.previousFog = scene.fog;
        scene.background = new THREE.Color(0x8fd8ff);
        scene.fog = new THREE.Fog(0xc7ecff, 55, 180);

        const renderer = context.scene.getRenderer();
        if (renderer) {
            this.previousShadowMapEnabled = renderer.shadowMap.enabled;
            this.previousShadowMapType = renderer.shadowMap.type;
            this.previousShadowMapAutoUpdate = renderer.shadowMap.autoUpdate;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFShadowMap;
            renderer.shadowMap.autoUpdate = true;
        }

        this.hemiLight = new THREE.HemisphereLight(0xe4f6ff, 0x88a86a, 1.2);
        scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xfff2cb, 1.8);
        this.sunLight.position.set(24, 30, 14);
        this.sunLight.target.position.set(0, 0, 0);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.set(2048, 2048);
        this.sunLight.shadow.bias = -0.0004;
        this.sunLight.shadow.normalBias = 0.04;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = 120;
        this.sunLight.shadow.camera.left = -55;
        this.sunLight.shadow.camera.right = 55;
        this.sunLight.shadow.camera.top = 55;
        this.sunLight.shadow.camera.bottom = -55;
        scene.add(this.sunLight);
        scene.add(this.sunLight.target);
    }

    private freezeShadowMap(context: IScenarioContext): void {
        const renderer = context.scene.getRenderer();
        if (!renderer || !renderer.shadowMap.enabled) return;
        renderer.shadowMap.needsUpdate = true;
        renderer.shadowMap.autoUpdate = false;
    }

    private buildTrackVisuals(): void {
        for (const [gx, gz, piece, orient] of SIMPLE_RACING_TRACK_CELLS) {
            const source = this.loadedModels[TRACK_MODEL_BY_PIECE[piece]];
            if (!source) continue;

            const object = source.clone(true);
            object.position.set((gx + 0.5) * SIMPLE_RACING_CELL_RAW, 0.5, (gz + 0.5) * SIMPLE_RACING_CELL_RAW);
            object.rotation.y = THREE.MathUtils.degToRad(SIMPLE_RACING_ORIENT_DEG[orient] ?? 0);
            object.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (!mesh.isMesh) return;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            });
            this.root.add(object);
        }
    }

    private buildDecorationVisuals(): void {
        const occupied = new Set<string>();
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;

        for (const [gx, gz] of SIMPLE_RACING_TRACK_CELLS) {
            occupied.add(`${gx},${gz}`);
            minX = Math.min(minX, gx);
            maxX = Math.max(maxX, gx);
            minZ = Math.min(minZ, gz);
            maxZ = Math.max(maxZ, gz);
        }

        const emptySource = this.loadedModels.decorationEmpty;
        const forestSource = this.loadedModels.decorationForest;
        const tentSource = this.loadedModels.decorationTents;
        const pad = 3;

        for (let gz = minZ - pad; gz <= maxZ + pad; gz += 1) {
            for (let gx = minX - pad; gx <= maxX + pad; gx += 1) {
                if (occupied.has(`${gx},${gz}`)) continue;

                const distX = gx < minX ? minX - gx : gx > maxX ? gx - maxX : 0;
                const distZ = gz < minZ ? minZ - gz : gz > maxZ ? gz - maxZ : 0;
                const dist = Math.max(distX, distZ);
                const random = hashCell(gx, gz);

                let source: THREE.Group | undefined;
                if (dist <= 1) {
                    source = (random % 7 === 0) ? tentSource : emptySource;
                } else {
                    source = forestSource;
                }
                if (!source) continue;

                const object = source.clone(true);
                object.position.set((gx + 0.5) * SIMPLE_RACING_CELL_RAW, 0.5, (gz + 0.5) * SIMPLE_RACING_CELL_RAW);
                object.rotation.y = ((random % 4) * Math.PI) / 2;
                object.traverse((child) => {
                    const mesh = child as THREE.Mesh;
                    if (!mesh.isMesh) return;
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                });
                this.root.add(object);
            }
        }
    }

    private createGameplayColliders(context: IScenarioContext): void {
        const wallHalfThickness = 0.25 * SIMPLE_RACING_GRID_SCALE;
        const wallHalfHeight = 1.5 * SIMPLE_RACING_GRID_SCALE;
        const wallY = (0.5 + 1.5) * SIMPLE_RACING_GRID_SCALE - 0.5;
        const wallX = 4.75 * SIMPLE_RACING_GRID_SCALE;
        const halfLen = (SIMPLE_RACING_CELL_RAW / 2) * SIMPLE_RACING_GRID_SCALE;

        for (const [gx, gz, piece, orient] of SIMPLE_RACING_TRACK_CELLS) {
            const centerX = (gx + 0.5) * SIMPLE_RACING_CELL;
            const centerZ = (gz + 0.5) * SIMPLE_RACING_CELL;
            const yaw = THREE.MathUtils.degToRad(SIMPLE_RACING_ORIENT_DEG[orient] ?? 0);

            if (piece === 'track-straight' || piece === 'track-finish') {
                for (const side of [-1, 1]) {
                    const localX = side * wallX;
                    const position = rotateLocalXZ(centerX, centerZ, localX, 0, yaw);
                this.addBody(context, {
                    position: { x: position.x, y: wallY, z: position.z },
                    halfExtents: { x: wallHalfThickness, y: wallHalfHeight, z: halfLen },
                    rotation: quaternionFromYaw(yaw),
                    material: TRACK_WALL_MATERIAL
                });
                }
                continue;
            }

            if (piece === 'track-corner') {
                this.createCornerArc(context, centerX, centerZ, yaw, wallY, wallHalfThickness, wallHalfHeight);
            }
        }
    }

    private createCornerArc(
        context: IScenarioContext,
        centerX: number,
        centerZ: number,
        yaw: number,
        wallY: number,
        wallHalfThickness: number,
        wallHalfHeight: number
    ): void {
        const cellHalf = SIMPLE_RACING_CELL_RAW / 2;
        const arcCenter = rotateLocalXZ(
            centerX,
            centerZ,
            -cellHalf * SIMPLE_RACING_GRID_SCALE,
            cellHalf * SIMPLE_RACING_GRID_SCALE,
            yaw
        );
        const outerRadius = (2 * cellHalf - 0.25) * SIMPLE_RACING_GRID_SCALE;
        const innerRadius = 0.25 * SIMPLE_RACING_GRID_SCALE;

        this.addArcBodies(context, arcCenter.x, arcCenter.z, -yaw, outerRadius, 8, wallY, wallHalfThickness, wallHalfHeight);
        this.addArcBodies(context, arcCenter.x, arcCenter.z, -yaw, innerRadius, 3, wallY, wallHalfThickness, wallHalfHeight);
    }

    private addArcBodies(
        context: IScenarioContext,
        centerX: number,
        centerZ: number,
        startAngle: number,
        radius: number,
        segmentCount: number,
        wallY: number,
        wallHalfThickness: number,
        wallHalfHeight: number
    ): void {
        const span = -Math.PI / 2;
        const segmentHalfLen = ((radius / segmentCount) * (Math.PI / 2) * 0.5);

        for (let index = 0; index < segmentCount; index += 1) {
            const midAngle = startAngle + (((index + 0.5) / segmentCount) * span);
            this.addBody(context, {
                position: {
                    x: centerX + (radius * Math.cos(midAngle)),
                    y: wallY,
                    z: centerZ + (radius * Math.sin(midAngle))
                },
                halfExtents: { x: wallHalfThickness, y: wallHalfHeight, z: segmentHalfLen },
                rotation: quaternionFromYaw(-midAngle),
                material: TRACK_WALL_MATERIAL
            });
        }
    }

    private addBody(
        context: IScenarioContext,
        options: {
            position: { x: number; y: number; z: number };
            halfExtents: { x: number; y: number; z: number };
            rotation: { x: number; y: number; z: number; w: number };
            material?: { friction?: number; restitution?: number };
        }
    ): void {
        const body = context.physics.createStaticBox(options);
        if (body) {
            this.gameplayBodies.push(body);
        }
    }
}

function rotateLocalXZ(centerX: number, centerZ: number, localX: number, localZ: number, yaw: number): { x: number; z: number } {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return {
        x: centerX + (localX * cos) + (localZ * sin),
        z: centerZ + (-localX * sin) + (localZ * cos)
    };
}

function quaternionFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
    return {
        x: 0,
        y: Math.sin(yaw / 2),
        z: 0,
        w: Math.cos(yaw / 2)
    };
}

function hashCell(gx: number, gz: number): number {
    let value = gx * 374761393 + gz * 668265263;
    value = (value ^ (value >> 13)) * 1274126177;
    return (value ^ (value >> 16)) >>> 0;
}
