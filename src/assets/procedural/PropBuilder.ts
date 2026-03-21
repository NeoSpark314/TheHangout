import * as THREE from 'three';
import { ISessionConfig } from '../../app/AppContext';
import { IDesktopScreenLayout } from '../../shared/contracts/IDesktopScreenLayout';
import { applyBoxEdgeGlow } from '../../render/materials/BoxEdgeGlow';
import { createSynthBlockMaterial } from '../../render/materials/SynthBlockMaterial';
import type { IScenarioStaticBodyHandle } from '../../content/contracts/IScenarioContext';

interface IPropBuilderRuntime {
    assets: {
        getNormalizedModel(url: string, targetSize?: number): Promise<THREE.Group>;
    };
    physics: {
        createStaticBox(options: {
            position: { x: number; y: number; z: number };
            halfExtents: { x: number; y: number; z: number };
            rotation?: { x: number; y: number; z: number; w: number };
        }): IScenarioStaticBodyHandle | null;
        removeBody(body: IScenarioStaticBodyHandle | null | undefined): void;
    };
    entities: {
        removeEntity(entityId: string): void;
    };
    spawnGrabbable?: (
        id: string,
        size: number,
        position: { x: number; y: number; z: number },
        mesh: THREE.Object3D | undefined,
        halfExtents?: { x: number; y: number; z: number }
    ) => unknown;
}

export class PropBuilder {
    private scene: THREE.Scene | null;
    private random: () => number;

    private tableGroup: THREE.Group | null = null;
    private table: THREE.Mesh | null = null;
    private hologram: THREE.Mesh | null = null;
    private duckModel: THREE.Object3D | null = null;
    private desiredHologramVisible: boolean = true;
    private podest: THREE.Group | null = null;
    private decorations: THREE.Group | null = null;
    private hasSpawnedDominoes: boolean = false;
    private readonly spawnedEntityIds: string[] = [];
    private readonly staticPhysicsBodies: IScenarioStaticBodyHandle[] = [];

    constructor(scene: THREE.Scene | null, randomFunc: () => number, private runtime: IPropBuilderRuntime) {
        this.scene = scene;
        this.random = randomFunc;
    }

    public applyConfig(config: ISessionConfig): void {
        if (!config) return;

        try {
            if (!this.table) this.createTable();
            if (!this.hologram) this.createHologram();
            if (!this.podest) this.createPodest();
            if (!this.decorations) this.createDecorations();
            // Domino run disabled for now until grab/interaction shape tuning is improved.
            // if (!this.hasSpawnedDominoes) this.createDominoRun();
        } catch (e) {
            console.error('[PropBuilder] applyConfig crashed:', e);
        }
    }

    public update(delta: number): void {
        if (this.hologram) {
            this.hologram.rotation.y += delta * 1.5;
            this.hologram.rotation.z += delta * 0.5;
            this.hologram.position.y = 0.5 + Math.sin(Date.now() * 0.002) * 0.05;
        }
    }

    private createTable(): void {
        let tableGroup: THREE.Group | null = null;
        if (this.scene) {
            tableGroup = new THREE.Group();
            this.tableGroup = tableGroup;
            const topGeo = new THREE.CylinderGeometry(2, 2, 0.1, 6);
            const topMat = new THREE.MeshStandardMaterial({
                color: 0x1a1a2e,
                emissive: 0x001133,
                metalness: 0.9,
                roughness: 0.4
            });
            this.table = new THREE.Mesh(topGeo, topMat);
            this.table.position.y = 1.0;
            tableGroup.add(this.table);

            const edges = new THREE.EdgesGeometry(topGeo);
            const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff });
            const outline = new THREE.LineSegments(edges, lineMat);
            this.table.add(outline);

            const coreGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 6);
            const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
            const core = new THREE.Mesh(coreGeo, coreMat);
            core.position.y = 0.05;
            this.table.add(core);

            const baseGeo = new THREE.CylinderGeometry(0.3, 0.8, 1.0, 6);
            const baseMat = new THREE.MeshBasicMaterial({ color: 0x0a0a1a });
            const base = new THREE.Mesh(baseGeo, baseMat);
            base.position.y = 0.5;
            tableGroup.add(base);

            this.scene.add(tableGroup);
        }

        // Exact regular-hex tabletop from 3 rotated strips:
        // For a regular hexagon built from CylinderGeometry radius R, side length s = R.
        // The strip half-width is the apothem: a = s * sqrt(3) / 2.
        const tableRadius = 2.0;
        const sideLength = tableRadius;
        const apothem = sideLength * Math.sqrt(3) * 0.5;
        const stripHalfNormal = apothem;
        const stripHalfTangent = sideLength * 0.5;
        const topHalfThickness = 0.05;
        const topY = 1.0;

        const topBodies: Array<THREE.Quaternion> = [
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (2 * Math.PI) / 3)
        ];

        for (const q of topBodies) {
            const body = this.runtime.physics.createStaticBox({
                position: { x: 0, y: topY, z: 0 },
                halfExtents: { x: stripHalfNormal, y: topHalfThickness, z: stripHalfTangent },
                rotation: { x: q.x, y: q.y, z: q.z, w: q.w }
            });
            if (body) this.staticPhysicsBodies.push(body);
        }

        const baseBody = this.runtime.physics.createStaticBox({
            position: { x: 0, y: 0.45, z: 0 },
            halfExtents: { x: 0.4, y: 0.45, z: 0.4 }
        });
        if (baseBody) this.staticPhysicsBodies.push(baseBody);
    }

    private createHologram(): void {
        if (!this.table || !this.scene) return;
        const holoGeo = new THREE.IcosahedronGeometry(0.35, 1);
        const holoMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            wireframe: true,
            transparent: true,
            opacity: 0.5
        });
        this.hologram = new THREE.Mesh(holoGeo, holoMat);
        this.hologram.position.y = 0.5;
        this.table.add(this.hologram);

        this.runtime.assets.getNormalizedModel('models/duck.glb', 0.25).then(duck => {
            if (this.hologram) {
                this.duckModel = duck;
                this.duckModel.visible = this.desiredHologramVisible;
                this.hologram.add(duck);
                this.hologram.visible = this.desiredHologramVisible;
            }
        });

    }

    private createPodest(): void {
        this.podest = new THREE.Group();
        const podestMat = createSynthBlockMaterial({
            topColor: 0x1f6fb5,
            bottomColor: 0x070d1f,
            edgeColor: 0xb8eaff,
            edgeThicknessWorld: 0.012,
            edgeFeatherWorld: 0.008,
            edgeIntensity: 0.45,
            rimIntensity: 0.08
        });
        const podestMesh = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.22, 8.0), podestMat);
        podestMesh.position.set(0, 0.11, 0);
        this.podest.add(podestMesh);
        if (this.scene) this.scene.add(this.podest);

        const body = this.runtime.physics.createStaticBox({
            position: { x: 0, y: 0.11, z: 0 },
            halfExtents: { x: 4.0, y: 0.11, z: 4.0 }
        });
        if (body) this.staticPhysicsBodies.push(body);
    }

    private createDecorations(): void {
        this.decorations = new THREE.Group();
        const pillarMat = createSynthBlockMaterial({
            topColor: 0x864bc6,
            bottomColor: 0x120724,
            edgeColor: 0xdfc7ff,
            edgeThicknessWorld: 0.012,
            edgeFeatherWorld: 0.008,
            edgeIntensity: 0.4,
            rimIntensity: 0.1
        });
        const pillarGeo = new THREE.BoxGeometry(1, 1, 1);
        const pillarCount = 12;
        const pillarMesh = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarCount);
        const pillarPosition = new THREE.Vector3();
        const pillarQuaternion = new THREE.Quaternion();
        const pillarScale = new THREE.Vector3();
        const pillarMatrix = new THREE.Matrix4();
        let instanceIndex = 0;

        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const h = 0.5 + this.random() * 2.5;
            const w = 0.4 + this.random() * 0.6;
            const posX = Math.sin(angle) * (6.0 + this.random() * 2);
            const posZ = Math.cos(angle) * (6.0 + this.random() * 2);

            pillarPosition.set(posX, h / 2, posZ);
            pillarScale.set(w, h, w);
            pillarMatrix.compose(pillarPosition, pillarQuaternion, pillarScale);
            pillarMesh.setMatrixAt(instanceIndex, pillarMatrix);
            instanceIndex++;

            // Add static physics collider
            const colliderBody = this.runtime.physics.createStaticBox({
                position: { x: posX, y: h / 2, z: posZ },
                halfExtents: { x: w / 2, y: h / 2, z: w / 2 }
            });
            if (colliderBody) this.staticPhysicsBodies.push(colliderBody);
        }
        pillarMesh.instanceMatrix.needsUpdate = true;
        this.decorations.add(pillarMesh);
        if (this.scene) this.scene.add(this.decorations);
    }

    private createDominoRun(): void {
        this.hasSpawnedDominoes = true;

        const base = new THREE.Vector3(-3.5, 0.35, -2.6);
        const dominoCount = 24;
        const step = 0.28;
        const half = { x: 0.03, y: 0.13, z: 0.09 };

        for (let i = 0; i < dominoCount; i++) {
            const lane = Math.floor(i / 8);
            const laneDir = lane % 2 === 0 ? 1 : -1;
            const laneIndex = i % 8;
            const x = base.x + laneDir * (laneIndex * step);
            const z = base.z + lane * 0.45;
            const yaw = laneDir > 0 ? 0 : Math.PI;

            const geo = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
            const hue = (i / dominoCount) * 0.75;
            const color = new THREE.Color().setHSL(hue, 1.0, 0.56);
            const mat = new THREE.MeshStandardMaterial({
                color,
                emissive: color.clone().multiplyScalar(0.55),
                emissiveIntensity: 0.3,
                metalness: 0.35,
                roughness: 0.45
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, base.y, z);
            mesh.rotation.y = yaw;

            const id = `domino-${i}`;
            this.runtime.spawnGrabbable?.(
                id,
                0.12,
                { x, y: base.y, z },
                mesh,
                half
            );
            this.spawnedEntityIds.push(id);
        }
    }

    public clearProcedural(): void {
        const remove = (obj: THREE.Object3D | null) => {
            if (!obj) return;
            if (this.scene) {
                this.scene.remove(obj);
            }
            obj.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                    else mesh.material.dispose();
                }
            });
        };
        for (const entityId of this.spawnedEntityIds) {
            this.runtime.entities.removeEntity(entityId);
        }
        this.spawnedEntityIds.length = 0;

        for (const body of this.staticPhysicsBodies) {
            this.runtime.physics.removeBody(body);
        }
        this.staticPhysicsBodies.length = 0;

        remove(this.tableGroup);
        remove(this.podest);
        remove(this.decorations);
        this.tableGroup = null;
        this.table = null;
        this.hologram = null;
        this.duckModel = null;
        this.podest = null;
        this.decorations = null;
        this.hasSpawnedDominoes = false;
    }

    public dispose(): void {
        this.clearProcedural();
    }

    public spawnGrabbableCube(position?: { x: number, y: number, z: number }): void {
        const colors = [0xff0055, 0x00ff88, 0x5500ff, 0xff8800, 0x00ccff, 0xffff00];
        const color = colors[Math.floor(this.random() * colors.length)];
        const pos = position || { x: (this.random() - 0.5) * 2, y: 1.5, z: (this.random() - 0.5) * 2 };

        let mesh = undefined;
        if (this.scene) {
            const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
            const mat = new THREE.MeshStandardMaterial({
                color: color, emissive: color, emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.3
            });
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(pos.x, pos.y, pos.z);
            applyBoxEdgeGlow(mesh, mat, { x: 0.06, y: 0.06, z: 0.06 }, {
                edgeColor: 0xffffff,
                edgeThicknessWorld: 0.0035,
                edgeFeatherWorld: 0.0018,
                intensity: 0.42
            });
        }

        const entityId = `admin-spawn-${Date.now()}`;
        const entity = this.runtime.spawnGrabbable?.(entityId, 0.12, pos, mesh as any);
        if (entity) {
            this.spawnedEntityIds.push(entityId);
        }
    }

    public getDesktopLayout(index: number, _total: number): IDesktopScreenLayout {
        // Logic for the CyperStube session: large billboard on the table
        // We increase the gap to 1.5 to prevent vertical overlap when multiple sources are active
        return {
            position: [0, 1.8 + index * 1.5, 0],
            scale: [1.5, 1.5, 1.5],
            billboard: true
        };
    }

    public setHologramVisible(visible: boolean): void {
        this.desiredHologramVisible = visible;
        if (this.duckModel) {
            this.duckModel.visible = visible;
        }
        if (this.hologram) {
            this.hologram.visible = visible;
        }
    }
}
