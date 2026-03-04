import * as THREE from 'three';
import { EntityFactory } from '../../world/spawning/EntityFactory';
import { AppContext, ISessionConfig } from '../../app/AppContext';
import { IDesktopScreenLayout } from '../../shared/contracts/IDesktopScreenLayout';

export class PropBuilder {
    private scene: THREE.Scene;
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
    private readonly staticPhysicsBodies: unknown[] = [];

    constructor(scene: THREE.Scene, randomFunc: () => number, private context: AppContext) {
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

        if (this.context.runtime.physics) {
            const tableBody = this.context.runtime.physics.createHexagon(2.0, 0.5, { x: 0, y: 0.8, z: 0 }, tableGroup, true);
            const baseBody = this.context.runtime.physics.createCuboid(0.4, 0.45, 0.4, { x: 0, y: 0.45, z: 0 }, null, true);
            if (tableBody) this.staticPhysicsBodies.push(tableBody);
            if (baseBody) this.staticPhysicsBodies.push(baseBody);
        }
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

        this.context.runtime.assets.getNormalizedModel('models/duck.glb', 0.25).then(duck => {
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
        const podestMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a20,
            metalness: 0.8, roughness: 0.5, emissive: 0x000510
        });
        const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 });
        const blockGeo = new THREE.BoxGeometry(1.0, 0.2, 1.0);

        for (let x = -4; x < 4; x++) {
            for (let z = -4; z < 4; z++) {
                const hOffset = this.random() * 0.05;
                if (this.scene) {
                    const segment = new THREE.Mesh(blockGeo, podestMat);
                    segment.position.set(x + 0.5, 0.1 + hOffset, z + 0.5);
                    const segmentOutline = new THREE.LineSegments(new THREE.EdgesGeometry(blockGeo), wireMat);
                    segment.add(segmentOutline);
                    this.podest.add(segment);
                }

                // Add static physics collider
                if (this.context.runtime.physics) {
                    const colliderBody = this.context.runtime.physics.createCuboid(0.5, 0.1, 0.5, { x: x + 0.5, y: 0.1 + hOffset, z: z + 0.5 }, null, true);
                    if (colliderBody) this.staticPhysicsBodies.push(colliderBody);
                }
            }
        }
        if (this.scene) this.scene.add(this.podest);
    }

    private createDecorations(): void {
        this.decorations = new THREE.Group();
        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x050515, metalness: 0.9, roughness: 0.1, emissive: 0x001122
        });
        const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.4 });

        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const h = 0.5 + this.random() * 2.5;
            const w = 0.4 + this.random() * 0.6;
            const geo = new THREE.BoxGeometry(w, h, w);
            const posX = Math.sin(angle) * (6.0 + this.random() * 2);
            const posZ = Math.cos(angle) * (6.0 + this.random() * 2);

            if (this.scene) {
                const pillar = new THREE.Mesh(geo, pillarMat);
                pillar.position.set(posX, h / 2, posZ);
                pillar.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), wireMat));
                this.decorations.add(pillar);
            }

            // Add static physics collider
            if (this.context.runtime.physics) {
                const colliderBody = this.context.runtime.physics.createCuboid(w / 2, h / 2, w / 2, { x: posX, y: h / 2, z: posZ }, null, true);
                if (colliderBody) this.staticPhysicsBodies.push(colliderBody);
            }
        }
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
            mesh.add(new THREE.LineSegments(
                new THREE.EdgesGeometry(geo),
                new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
            ));

            const id = `domino-${i}`;
            EntityFactory.createGrabbable(
                this.context,
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
            this.context.runtime.entity.removeEntity(entityId);
        }
        this.spawnedEntityIds.length = 0;

        for (const body of this.staticPhysicsBodies) {
            this.context.runtime.physics.removeRigidBody(body as any);
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
        }

        const entityId = `admin-spawn-${Date.now()}`;
        const entity = EntityFactory.createGrabbable(this.context, entityId, 0.12, pos, mesh as any);
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
