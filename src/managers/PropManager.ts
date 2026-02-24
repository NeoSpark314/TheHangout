import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EntityFactory } from '../factories/EntityFactory';
import { RoomConfig } from '../core/GameState';
import gameState from '../core/GameState';

export class PropManager {
    private scene: THREE.Scene;
    private random: () => number;

    private table: THREE.Mesh | null = null;
    private hologram: THREE.Mesh | null = null;
    private podest: THREE.Group | null = null;
    private decorations: THREE.Group | null = null;
    private grabbablesSpawned: boolean = false;

    constructor(scene: THREE.Scene, randomFunc: () => number) {
        this.scene = scene;
        this.random = randomFunc;
    }

    public applyConfig(config: RoomConfig): void {
        if (!config) return;

        if (!this.table) this.createTable();
        if (!this.hologram) this.createHologram();
        if (!this.podest) this.createPodest();
        if (!this.decorations) this.createDecorations();
        if (!this.grabbablesSpawned) this.createGrabbables();
    }

    public update(delta: number): void {
        if (this.hologram) {
            this.hologram.rotation.y += delta * 1.5;
            this.hologram.rotation.z += delta * 0.5;
            this.hologram.position.y = 0.5 + Math.sin(Date.now() * 0.002) * 0.05;
        }
    }

    private createTable(): void {
        const tableGroup = new THREE.Group();
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

        if (gameState.managers.physics) {
            gameState.managers.physics.createHexagon(2.0, 0.5, { x: 0, y: 0.8, z: 0 }, tableGroup, true);
            gameState.managers.physics.createCuboid(0.4, 0.45, 0.4, { x: 0, y: 0.45, z: 0 }, null, true);
        }
    }

    private createHologram(): void {
        if (!this.table) return;
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

        const loader = new GLTFLoader();
        loader.load('/models/duck.glb', (gltf) => {
            const duck = gltf.scene;
            const box = new THREE.Box3().setFromObject(duck);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const targetScale = 0.25 / maxDim;
            duck.scale.setScalar(targetScale);
            const center = box.getCenter(new THREE.Vector3()).multiplyScalar(-targetScale);
            duck.position.copy(center);
            this.hologram?.add(duck);
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
                const segment = new THREE.Mesh(blockGeo, podestMat);
                segment.position.set(x + 0.5, 0.1 + hOffset, z + 0.5);
                const segmentOutline = new THREE.LineSegments(new THREE.EdgesGeometry(blockGeo), wireMat);
                segment.add(segmentOutline);
                this.podest.add(segment);
            }
        }
        this.scene.add(this.podest);
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
            const pillar = new THREE.Mesh(geo, pillarMat);
            pillar.position.set(Math.sin(angle) * (6.0 + this.random() * 2), h / 2, Math.cos(angle) * (6.0 + this.random() * 2));
            pillar.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), wireMat));
            this.decorations.add(pillar);
        }
        this.scene.add(this.decorations);
    }

    private createGrabbables(): void {
        if (!this.scene) return;
        this.grabbablesSpawned = true;
        const colors = [0xff0055, 0x00ff88, 0x5500ff, 0xff8800, 0x00ccff, 0xffff00];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const position = { x: Math.sin(angle), y: 1.15, z: Math.cos(angle) };
            const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
            const mat = new THREE.MeshStandardMaterial({
                color: colors[i], emissive: colors[i], emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.3
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(position.x, position.y, position.z);
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })));
            EntityFactory.createGrabbable(`grabbable-${i}`, 0.12, position, mesh);
        }
    }

    public clearProcedural(): void {
        const remove = (obj: THREE.Object3D | null) => {
            if (!obj) return;
            this.scene.remove(obj);
            obj.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                    else mesh.material.dispose();
                }
            });
        };
        remove(this.podest);
        remove(this.decorations);
        this.podest = null;
        this.decorations = null;
    }
}
