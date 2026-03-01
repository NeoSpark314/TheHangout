import * as THREE from 'three';
import { EntityFactory } from '../factories/EntityFactory';
import { GameContext, IRoomConfig } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { PhysicsEntity } from '../entities/PhysicsEntity';
import { IReplicatedFeature } from './ReplicationManager';
import { IDesktopScreenLayout } from '../interfaces/IDesktopScreenLayout';

interface IDrumPadHitPayload {
    padId: string;
    frequency: number;
    intensity: number;
    position?: { x: number; y: number; z: number };
}

export class PropManager implements IReplicatedFeature {
    public readonly featureId: string = 'feature:drumPads';
    private scene: THREE.Scene;
    private random: () => number;

    private table: THREE.Mesh | null = null;
    private hologram: THREE.Mesh | null = null;
    private duckModel: THREE.Object3D | null = null;
    private desiredHologramVisible: boolean = true;
    private podest: THREE.Group | null = null;
    private decorations: THREE.Group | null = null;
    private hasSpawnedGrabbables: boolean = false;
    private hasSpawnedDominoes: boolean = false;
    private drumPads: THREE.Group | null = null;
    private drumPadMeshes: THREE.Mesh[] = [];
    private drumPadPositions: THREE.Vector3[] = [];
    private drumPadFlash: number[] = [];
    private drumPadFreqByHandle: Map<number, { padId: string; frequency: number }> = new Map();
    private drumPadById: Map<string, { index: number; frequency: number; position: THREE.Vector3 }> = new Map();
    private handLastPos: Record<'left' | 'right', THREE.Vector3 | null> = { left: null, right: null };
    private lastHandPadHitAtMs: Map<string, number> = new Map();
    private onDrumPadHitHandler: ((data: { padId: string; frequency: number; intensity: number }) => void) | null = null;
    private onPhysicsCollisionStartedHandler: ((data: { handleA: number; handleB: number; entityAId: string | null; entityBId: string | null }) => void) | null = null;

    constructor(scene: THREE.Scene, randomFunc: () => number, private context: GameContext) {
        this.scene = scene;
        this.random = randomFunc;

        this.onDrumPadHitHandler = (data) => {
            const idx = this.parsePadIndex(data.padId);
            if (idx >= 0 && idx < this.drumPadFlash.length) {
                this.drumPadFlash[idx] = Math.max(this.drumPadFlash[idx], Math.min(1.0, data.intensity * 1.2));
            }
        };
        eventBus.on(EVENTS.DRUM_PAD_HIT, this.onDrumPadHitHandler);
        this.context.managers.replication.registerFeature(this);

        this.onPhysicsCollisionStartedHandler = (data) => {
            const padA = this.drumPadFreqByHandle.get(data.handleA);
            const padB = this.drumPadFreqByHandle.get(data.handleB);
            if (!padA && !padB) return;

            const hit = padA || padB!;
            const entityId = padA ? data.entityBId : data.entityAId;
            if (!entityId) return;
            const entity = this.context.managers.entity.getEntity(entityId) as PhysicsEntity | undefined;
            if (!entity || entity.type !== 'PHYSICS_PROP') return;

            const v = entity.rigidBody.linvel();
            const speed = Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
            const intensity = Math.max(0.08, Math.min(1.0, speed * 0.22));
            const padInfo = this.drumPadById.get(hit.padId);
            this.emitDrumHit({
                padId: hit.padId,
                frequency: hit.frequency,
                intensity,
                position: padInfo ? { x: padInfo.position.x, y: padInfo.position.y, z: padInfo.position.z } : undefined
            });
        };
        eventBus.on(EVENTS.PHYSICS_COLLISION_STARTED, this.onPhysicsCollisionStartedHandler);
    }

    public applyConfig(config: IRoomConfig): void {
        if (!config) return;

        try {
            if (!this.table) this.createTable();
            if (!this.hologram) this.createHologram();
            if (!this.podest) this.createPodest();
            if (!this.decorations) this.createDecorations();
            if (!this.drumPads) this.createDrumPads();
            if (!this.hasSpawnedGrabbables) this.createGrabbables();
            // Domino run disabled for now until grab/interaction shape tuning is improved.
            // if (!this.hasSpawnedDominoes) this.createDominoRun();
        } catch (e) {
            console.error('[PropManager] applyConfig crashed:', e);
        }
    }

    public update(delta: number): void {
        if (this.hologram) {
            this.hologram.rotation.y += delta * 1.5;
            this.hologram.rotation.z += delta * 0.5;
            this.hologram.position.y = 0.5 + Math.sin(Date.now() * 0.002) * 0.05;
        }

        for (let i = 0; i < this.drumPadMeshes.length; i++) {
            const mesh = this.drumPadMeshes[i];
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const flash = this.drumPadFlash[i] || 0;
            const target = 0.18 + flash * 1.3;
            mat.emissiveIntensity += (target - mat.emissiveIntensity) * 0.25;
            this.drumPadFlash[i] = Math.max(0, flash - delta * 2.2);
        }

        this.updateHandDrumHits(delta);
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

        if (this.scene) {
            this.scene.add(tableGroup);
        }

        if (this.context.managers.physics) {
            this.context.managers.physics.createHexagon(2.0, 0.5, { x: 0, y: 0.8, z: 0 }, tableGroup, true);
            this.context.managers.physics.createCuboid(0.4, 0.45, 0.4, { x: 0, y: 0.45, z: 0 }, null, true);
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

        this.context.managers.assets.getNormalizedModel('/models/duck.glb', 0.25).then(duck => {
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
                if (this.context.managers.physics) {
                    this.context.managers.physics.createCuboid(0.5, 0.1, 0.5, { x: x + 0.5, y: 0.1 + hOffset, z: z + 0.5 }, null, true);
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
            if (this.context.managers.physics) {
                this.context.managers.physics.createCuboid(w / 2, h / 2, w / 2, { x: posX, y: h / 2, z: posZ }, null, true);
            }
        }
        if (this.scene) this.scene.add(this.decorations);
    }

    private createGrabbables(): void {
        console.log('[PropManager] createGrabbables running...');
        this.hasSpawnedGrabbables = true;

        // Spawn a Pen
        const penId = 'pen-1';
        const pen = EntityFactory.spawn(this.context, 'PEN', penId, {
            position: { x: 0.5, y: 1.15, z: 0.5 }
        });
        if (pen) this.context.managers.entity.addEntity(pen);

        const colors = [0xff0055, 0x00ff88, 0x5500ff, 0xff8800, 0x00ccff, 0xffff00];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const position = { x: Math.sin(angle), y: 1.15, z: Math.cos(angle) };

            let mesh = undefined;
            if (this.scene) {
                const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
                const mat = new THREE.MeshStandardMaterial({
                    color: colors[i], emissive: colors[i], emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.3
                });
                mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(position.x, position.y, position.z);
                mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })));
            }

            const entityId = `grabbable-${i}`;
            EntityFactory.createGrabbable(this.context, entityId, 0.12, position, mesh as any);
        }
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
        }
    }

    private createDrumPads(): void {
        this.drumPads = new THREE.Group();
        this.drumPads.position.set(0, 0, 0);

        const notes = [220, 247, 277, 294, 330, 370, 415, 440];
        const padCount = notes.length;
        const radius = 1.85;
        const center = new THREE.Vector3(6.2, 1.1, -1.8);

        for (let i = 0; i < padCount; i++) {
            const t = (i / (padCount - 1));
            const angle = THREE.MathUtils.lerp(-0.95, 0.95, t);
            const px = center.x - Math.cos(angle) * radius;
            const pz = center.z + Math.sin(angle) * radius;
            const padY = center.y;

            const color = new THREE.Color().setHSL(0.72 - t * 0.6, 1.0, 0.54);
            const geo = new THREE.BoxGeometry(0.42, 0.08, 0.42);
            const mat = new THREE.MeshStandardMaterial({
                color,
                emissive: color.clone().multiplyScalar(0.8),
                emissiveIntensity: 0.18,
                metalness: 0.2,
                roughness: 0.38
            });
            const pad = new THREE.Mesh(geo, mat);
            pad.position.set(px, padY, pz);
            pad.add(new THREE.LineSegments(
                new THREE.EdgesGeometry(geo),
                new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.45 })
            ));
            this.drumPads.add(pad);
            this.drumPadMeshes.push(pad);
            this.drumPadPositions.push(new THREE.Vector3(px, padY, pz));
            this.drumPadFlash.push(0);
            this.drumPadById.set(`pad-${i}`, { index: i, frequency: notes[i], position: new THREE.Vector3(px, padY, pz) });

            const collider = this.context.managers.physics.createStaticCuboidCollider(
                0.21, 0.04, 0.21,
                { x: px, y: padY, z: pz }
            );
            if (collider) {
                this.drumPadFreqByHandle.set(collider.handle, { padId: `pad-${i}`, frequency: notes[i] });
            }
        }

        if (this.scene) this.scene.add(this.drumPads);
    }

    private updateHandDrumHits(delta: number): void {
        const trackingMgr = (this.context.managers as any).tracking;
        if (!trackingMgr || typeof trackingMgr.getState !== 'function') {
            // Headless dedicated server has no local tracking provider.
            this.handLastPos.left = null;
            this.handLastPos.right = null;
            return;
        }

        const tracking = trackingMgr.getState();
        const dt = Math.max(0.0001, delta);
        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
        const padRadius = 0.27;
        const strikeCooldownMs = 120;

        for (const hand of ['left', 'right'] as const) {
            const state = tracking.hands[hand];
            if (!state.active || this.drumPadPositions.length === 0) {
                this.handLastPos[hand] = null;
                continue;
            }

            const strikePose = this.getAvatarHandStrikePosition(hand);
            if (!strikePose) {
                this.handLastPos[hand] = null;
                continue;
            }
            const pos = new THREE.Vector3(strikePose.x, strikePose.y, strikePose.z);
            const prev = this.handLastPos[hand];
            this.handLastPos[hand] = pos;
            if (!prev) continue;

            const vx = (pos.x - prev.x) / dt;
            const vy = (pos.y - prev.y) / dt;
            const vz = (pos.z - prev.z) / dt;
            const speed = Math.hypot(vx, vy, vz);
            if (vy > -0.08 || speed < 0.28) continue;

            for (let i = 0; i < this.drumPadPositions.length; i++) {
                const padPos = this.drumPadPositions[i];
                const dx = pos.x - padPos.x;
                const dz = pos.z - padPos.z;
                const distXZ = Math.hypot(dx, dz);
                if (distXZ > padRadius) continue;

                const crossedTop = prev.y > (padPos.y + 0.1) && pos.y <= (padPos.y + 0.12);
                const nearTop = Math.abs(pos.y - padPos.y) <= 0.14;
                if (!crossedTop && !nearTop) continue;

                const key = `${hand}:${i}`;
                const lastHit = this.lastHandPadHitAtMs.get(key) ?? 0;
                if ((now - lastHit) < strikeCooldownMs) continue;
                this.lastHandPadHitAtMs.set(key, now);

                const strikeSpeed = Math.max(0, -vy) + speed * 0.22;
                const intensity = Math.min(1.0, Math.max(0.12, strikeSpeed * 0.12));
                const freq = this.drumPadById.get(`pad-${i}`)?.frequency ?? 220;
                this.emitDrumHit({
                    padId: `pad-${i}`,
                    frequency: freq,
                    intensity,
                    position: { x: padPos.x, y: padPos.y, z: padPos.z }
                });
            }
        }
    }

    private getAvatarHandStrikePosition(hand: 'left' | 'right'): { x: number; y: number; z: number } | null {
        const trackingMgr = (this.context.managers as any).tracking;
        if (!trackingMgr || typeof trackingMgr.getState !== 'function') return null;
        const trackingState = trackingMgr.getState().hands[hand];
        const localHumanoidJoints = this.context.localPlayer?.humanoid?.joints;

        if (trackingState.hasJoints) {
            const tipPose = trackingState.joints[9]?.pose?.position;
            if (tipPose && (tipPose.x !== 0 || tipPose.y !== 0 || tipPose.z !== 0)) {
                return tipPose;
            }
        }

        const wristName = hand === 'left' ? 'leftHand' : 'rightHand';
        const wristPose = localHumanoidJoints?.[wristName]?.position;
        if (wristPose && (wristPose.x !== 0 || wristPose.y !== 0 || wristPose.z !== 0)) {
            return wristPose;
        }

        const handPose = trackingState.pose.position;
        if (handPose && (handPose.x !== 0 || handPose.y !== 0 || handPose.z !== 0)) {
            return handPose;
        }

        return null;
    }

    public onEvent(eventType: string, data: unknown): void {
        if (eventType !== 'hit') return;
        const hit = data as IDrumPadHitPayload;
        if (!hit || typeof hit.padId !== 'string') return;
        if (typeof hit.frequency !== 'number' || typeof hit.intensity !== 'number') return;
        eventBus.emit(EVENTS.DRUM_PAD_HIT, hit);
    }

    private emitDrumHit(hit: IDrumPadHitPayload): void {
        this.context.managers.replication.emitFeatureEvent(this.featureId, 'hit', hit);
    }

    public clearProcedural(): void {
        const remove = (obj: THREE.Object3D | null) => {
            if (!obj || !this.scene) return;
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
        remove(this.drumPads);
        this.podest = null;
        this.decorations = null;
        this.drumPads = null;
        this.drumPadMeshes = [];
        this.drumPadPositions = [];
        this.drumPadFlash = [];
        this.drumPadFreqByHandle.clear();
        this.drumPadById.clear();
        this.handLastPos.left = null;
        this.handLastPos.right = null;
        this.lastHandPadHitAtMs.clear();
    }

    private parsePadIndex(padId: string): number {
        if (!padId.startsWith('pad-')) return -1;
        const v = Number.parseInt(padId.slice(4), 10);
        return Number.isFinite(v) ? v : -1;
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
        EntityFactory.createGrabbable(this.context, entityId, 0.12, pos, mesh as any);
    }

    public getDesktopLayout(index: number, _total: number): IDesktopScreenLayout {
        // Logic for the CyperStube room: large billboard on the table
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
