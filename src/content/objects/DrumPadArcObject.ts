import * as THREE from 'three';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta, IReplicatedObjectInstance } from '../contracts/IReplicatedObjectInstance';
import { EntityType } from '../../shared/contracts/IEntityState';
import { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';

interface IDrumPadHitPayload {
    padId: string;
    frequency: number;
    intensity: number;
    position?: { x: number; y: number; z: number };
}

type TBeatLane = 'kick' | 'snare' | 'hat' | 'bass';
const BEAT_LANES: TBeatLane[] = ['kick', 'snare', 'hat', 'bass'];
type TPadPhraseId = `pad-${number}`;
type TArpStripId = 'arp-0' | 'arp-1' | 'arp-2';
const ARP_STRIPS: TArpStripId[] = ['arp-0', 'arp-1', 'arp-2'];

interface IStationTogglePayload {
    lane: TBeatLane;
}

interface IPadPhraseRequestPayload {
    padId: TPadPhraseId;
}

interface IPadPhraseStartPayload {
    padId: TPadPhraseId;
    startStep: number;
}

interface IArpTouchPayload {
    stripId: TArpStripId;
    sourceId: string;
    active: boolean;
}

interface IArpTouchStatePayload {
    stripId: TArpStripId;
    active: boolean;
}

interface ISequencerSnapshot {
    version: 1;
    bpm: number;
    isPlaying: boolean;
    stepIndex: number;
    stepPhaseMs: number;
    laneEnabled: Record<TBeatLane, boolean>;
    arpActive: Record<TArpStripId, boolean>;
}

interface IActivePadPhrase {
    padId: TPadPhraseId;
    startStep: number;
}

class DrumPadArcInstance extends BaseReplicatedObjectInstance implements IReplicatedObjectInstance {
    private readonly padMeshes: THREE.Mesh[] = [];
    private readonly padPositions: THREE.Vector3[] = [];
    private readonly padFlash: number[] = [];
    private readonly padFreqByHandle = new Map<number, { padId: string; frequency: number }>();
    private readonly padById = new Map<string, { index: number; frequency: number; position: THREE.Vector3 }>();
    private readonly handLastPos: Record<'left' | 'right', THREE.Vector3 | null> = { left: null, right: null };
    private readonly lastHandPadHitAtMs = new Map<string, number>();
    private readonly handPadArmed = new Map<string, boolean>();
    private readonly padTouchCooldownAtMs = new Map<string, number>();
    private readonly padPhraseById = new Map<TPadPhraseId, IActivePadPhrase>();
    private readonly padPhraseRootFreqById: Record<TPadPhraseId, number> = {
        'pad-0': 164.81,
        'pad-1': 196.0,
        'pad-2': 220.0,
        'pad-3': 246.94,
        'pad-4': 293.66,
        'pad-5': 329.63,
        'pad-6': 392.0,
        'pad-7': 440.0
    };
    private readonly padPhrasePatternById: Record<TPadPhraseId, ReadonlyArray<{ offsetSemitones: number; stepOffset: number; intensity: number }>> = {
        'pad-0': [{ offsetSemitones: 0, stepOffset: 0, intensity: 0.72 }, { offsetSemitones: 7, stepOffset: 2, intensity: 0.68 }, { offsetSemitones: 12, stepOffset: 4, intensity: 0.66 }, { offsetSemitones: 7, stepOffset: 6, intensity: 0.64 }],
        'pad-1': [{ offsetSemitones: 0, stepOffset: 0, intensity: 0.72 }, { offsetSemitones: 3, stepOffset: 2, intensity: 0.68 }, { offsetSemitones: 7, stepOffset: 4, intensity: 0.66 }, { offsetSemitones: 10, stepOffset: 6, intensity: 0.64 }],
        'pad-2': [{ offsetSemitones: 0, stepOffset: 0, intensity: 0.72 }, { offsetSemitones: 7, stepOffset: 1, intensity: 0.64 }, { offsetSemitones: 12, stepOffset: 3, intensity: 0.68 }, { offsetSemitones: 7, stepOffset: 5, intensity: 0.62 }],
        'pad-3': [{ offsetSemitones: 0, stepOffset: 0, intensity: 0.72 }, { offsetSemitones: 5, stepOffset: 2, intensity: 0.66 }, { offsetSemitones: 10, stepOffset: 4, intensity: 0.64 }, { offsetSemitones: 12, stepOffset: 7, intensity: 0.6 }],
        'pad-4': [{ offsetSemitones: 0, stepOffset: 0, intensity: 0.72 }, { offsetSemitones: 7, stepOffset: 2, intensity: 0.67 }, { offsetSemitones: 12, stepOffset: 3, intensity: 0.65 }, { offsetSemitones: 15, stepOffset: 6, intensity: 0.62 }],
        'pad-5': [{ offsetSemitones: 0, stepOffset: 0, intensity: 0.72 }, { offsetSemitones: 3, stepOffset: 1, intensity: 0.66 }, { offsetSemitones: 7, stepOffset: 3, intensity: 0.64 }, { offsetSemitones: 12, stepOffset: 5, intensity: 0.62 }],
        'pad-6': [{ offsetSemitones: 0, stepOffset: 0, intensity: 0.7 }, { offsetSemitones: 7, stepOffset: 2, intensity: 0.66 }, { offsetSemitones: 12, stepOffset: 4, intensity: 0.64 }, { offsetSemitones: 19, stepOffset: 6, intensity: 0.6 }],
        'pad-7': [{ offsetSemitones: 0, stepOffset: 0, intensity: 0.7 }, { offsetSemitones: 5, stepOffset: 1, intensity: 0.64 }, { offsetSemitones: 12, stepOffset: 3, intensity: 0.66 }, { offsetSemitones: 17, stepOffset: 5, intensity: 0.6 }]
    };
    private readonly group: THREE.Group | null;

    private readonly stationCenter = new THREE.Vector3(6.2, 1.25, -1.8);
    private readonly laneToggleMeshes = new Map<TBeatLane, THREE.Mesh>();
    private readonly laneTogglePositions = new Map<TBeatLane, THREE.Vector3>();
    private readonly laneToggleByHandle = new Map<number, TBeatLane>();
    private readonly arpStripMeshes = new Map<TArpStripId, THREE.Mesh>();
    private readonly arpStripPositions = new Map<TArpStripId, THREE.Vector3>();
    private readonly arpStripByHandle = new Map<number, TArpStripId>();
    private readonly arpStripActive: Record<TArpStripId, boolean> = { 'arp-0': false, 'arp-1': false, 'arp-2': false };
    private readonly arpTouchSourcesByStrip = new Map<TArpStripId, Set<string>>();
    private readonly lanePulse: Record<TBeatLane, number> = { kick: 0, snare: 0, hat: 0, bass: 0 };
    private readonly lanePattern: Record<TBeatLane, ReadonlySet<number>> = {
        kick: new Set([0, 4, 8, 12]),
        snare: new Set([4, 12]),
        hat: new Set([2, 6, 10, 14]),
        bass: new Set([0, 6, 8, 12])
    };
    private laneEnabled: Record<TBeatLane, boolean> = {
        kick: false,
        snare: false,
        hat: false,
        bass: false
    };
    private bpm: number = 124;
    private isPlaying: boolean = false;
    private sequencerAnchorMs: number = 0;
    private lastProcessedAbsoluteStep: number | null = null;
    private lastSyncBroadcastAtMs: number = 0;

    private readonly handLastTogglePos: Record<'left' | 'right', THREE.Vector3 | null> = { left: null, right: null };
    private readonly lastHandToggleAtMs = new Map<string, number>();
    private readonly handToggleArmed = new Map<string, boolean>();
    private readonly handActiveArpStripByHand: Record<'left' | 'right', TArpStripId | null> = { left: null, right: null };

    constructor(context: IObjectSpawnContext, moduleId: string) {
        super(context, moduleId);
        this.group = this.context.app.runtime.render ? this.ownSceneObject(new THREE.Group()) : null;
        this.sequencerAnchorMs = this.nowMs();

        if (this.group) {
            this.group.name = `drum-pad-arc:${this.id}`;
        }

        this.createDrumPads();
        this.createLaneToggles();
        this.createArpStrips();
        this.bindCollisionListener();
    }

    public update(delta: number): void {
        for (let i = 0; i < this.padMeshes.length; i++) {
            const mesh = this.padMeshes[i];
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const flash = this.padFlash[i] || 0;
            const target = 0.18 + flash * 1.3;
            mat.emissiveIntensity += (target - mat.emissiveIntensity) * 0.25;
            this.padFlash[i] = Math.max(0, flash - delta * 2.2);
        }

        this.updateToggleVisuals(delta);
        this.updateSequencer();
        this.updateHandPadTouches(delta);
        this.updateHandToggleHits(delta);
        this.updateHandArpTouches();
    }

    public destroy(): void {
        this.padFreqByHandle.clear();
        this.padById.clear();
        this.padPositions.length = 0;
        this.padFlash.length = 0;
        this.lastHandPadHitAtMs.clear();
        this.lastHandToggleAtMs.clear();
        this.handPadArmed.clear();
        this.handToggleArmed.clear();
        this.padTouchCooldownAtMs.clear();
        this.padPhraseById.clear();
        this.handLastPos.left = null;
        this.handLastPos.right = null;
        this.handLastTogglePos.left = null;
        this.handLastTogglePos.right = null;
        this.handActiveArpStripByHand.left = null;
        this.handActiveArpStripByHand.right = null;
        this.padMeshes.length = 0;
        this.laneToggleMeshes.clear();
        this.laneTogglePositions.clear();
        this.laneToggleByHandle.clear();
        this.arpStripMeshes.clear();
        this.arpStripPositions.clear();
        this.arpStripByHandle.clear();
        this.arpTouchSourcesByStrip.clear();
        this.lastProcessedAbsoluteStep = null;
        super.destroy();
    }

    public onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void {
        if (eventType === 'hit') {
            if (meta.local) return;
            const hit = data as IDrumPadHitPayload;
            if (!this.isValidHit(hit)) return;
            this.applyDrumHit(hit, false);
            return;
        }

        if (eventType === 'phrase-request') {
            const req = data as IPadPhraseRequestPayload;
            if (!this.isValidPadPhraseRequest(req)) return;
            if (!this.context.app.isHost) return;
            this.startPadPhrase(req.padId);
            return;
        }

        if (eventType === 'phrase-start') {
            if (meta.local) return;
            const start = data as IPadPhraseStartPayload;
            if (!this.isValidPadPhraseStart(start)) return;
            this.applyPadPhraseStart(start);
            return;
        }

        if (eventType === 'arp-touch-request') {
            const req = data as IArpTouchPayload;
            if (!this.isValidArpTouchPayload(req)) return;
            if (!this.context.app.isHost) return;
            const changed = this.applyArpTouchSource(req.stripId, req.sourceId, req.active);
            if (changed) {
                this.emitSyncEvent('arp-touch-state', {
                    stripId: req.stripId,
                    active: this.arpStripActive[req.stripId]
                } satisfies IArpTouchStatePayload);
            }
            return;
        }

        if (eventType === 'arp-touch-state') {
            if (meta.local) return;
            const state = data as IArpTouchStatePayload;
            if (!this.isValidArpTouchStatePayload(state)) return;
            this.applyArpStripActive(state.stripId, state.active);
            return;
        }

        if (eventType === 'station-toggle') {
            const toggle = data as IStationTogglePayload;
            if (!this.isValidToggle(toggle)) return;
            if (!this.context.app.isHost) return;
            this.toggleLane(toggle.lane);
            this.broadcastSequencerSnapshot();
            return;
        }

        if (eventType === 'station-sync') {
            if (meta.local) return;
            const snapshot = data as ISequencerSnapshot;
            this.applySequencerSnapshot(snapshot);
        }
    }

    public captureReplicationSnapshot(): unknown {
        return this.captureSequencerSnapshot();
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        this.applySequencerSnapshot(snapshot as ISequencerSnapshot);
    }

    private createDrumPads(): void {
        // E minor pentatonic across two octaves for a melodic, always-musical layout.
        const notes = [164.81, 196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0];
        const padCount = notes.length;
        const radius = 1.74;
        const center = new THREE.Vector3(6.2, 1.1, -1.8);
        this.stationCenter.set(center.x, center.y + 0.24, center.z);

        for (let i = 0; i < padCount; i++) {
            const t = (i / (padCount - 1));
            const angle = THREE.MathUtils.lerp(-0.95, 0.95, t);
            const px = center.x - Math.cos(angle) * radius;
            const pz = center.z + Math.sin(angle) * radius;
            const padY = center.y;

            if (this.group) {
                const color = new THREE.Color().setHSL(0.72 - t * 0.6, 1.0, 0.54);
                const geo = new THREE.BoxGeometry(0.52, 0.065, 0.29);
                const mat = new THREE.MeshStandardMaterial({
                    color,
                    emissive: color.clone().multiplyScalar(0.8),
                    emissiveIntensity: 0.18,
                    metalness: 0.24,
                    roughness: 0.32
                });
                const pad = new THREE.Mesh(geo, mat);
                pad.position.set(px, padY, pz);
                pad.rotation.y = angle + Math.PI / 2;
                pad.rotation.x = THREE.MathUtils.degToRad(-8);
                pad.add(new THREE.LineSegments(
                    new THREE.EdgesGeometry(geo),
                    new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.45 })
                ));
                this.group.add(pad);
                this.padMeshes.push(pad);
            }

            const position = new THREE.Vector3(px, padY, pz);
            this.padPositions.push(position);
            this.padFlash.push(0);
            this.padById.set(`pad-${i}`, { index: i, frequency: notes[i], position });

            const collider = this.context.physics.createStaticCuboidCollider(
                0.26, 0.04, 0.15,
                { x: px, y: padY, z: pz }
            );
            if (collider) {
                this.padFreqByHandle.set(collider.id, { padId: `pad-${i}`, frequency: notes[i] });
                const body = collider.body;
                if (body) {
                    this.ownPhysicsBody(body);
                }
            }
        }
    }

    private createLaneToggles(): void {
        const toggleRadius = 1.84;
        const baseY = this.stationCenter.y + 0.48;
        const laneAngles: Record<TBeatLane, number> = {
            kick: -0.78,
            snare: -0.24,
            hat: 0.24,
            bass: 0.78
        };
        const colors: Record<TBeatLane, number> = {
            kick: 0xff4b6e,
            snare: 0x30d0ff,
            hat: 0xffd447,
            bass: 0x9d7bff
        };

        for (const lane of BEAT_LANES) {
            const angle = laneAngles[lane];
            const position = new THREE.Vector3(
                this.stationCenter.x - Math.cos(angle) * toggleRadius,
                baseY,
                this.stationCenter.z + Math.sin(angle) * toggleRadius
            );
            this.laneTogglePositions.set(lane, position);

            if (this.group) {
                const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
                const color = new THREE.Color(colors[lane]);
                const mat = new THREE.MeshStandardMaterial({
                    color,
                    emissive: color.clone().multiplyScalar(0.9),
                    emissiveIntensity: this.laneEnabled[lane] ? 0.9 : 0.18,
                    metalness: 0.28,
                    roughness: 0.3
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(position);
                mesh.rotation.y = angle + Math.PI / 2;
                mesh.name = `drum-lane-toggle:${lane}:${this.id}`;
                mesh.add(new THREE.LineSegments(
                    new THREE.EdgesGeometry(geo),
                    new THREE.LineBasicMaterial({ color: 0x7fffff, transparent: true, opacity: 0.5 })
                ));
                this.group.add(mesh);
                this.laneToggleMeshes.set(lane, mesh);
            }

            const collider = this.context.physics.createStaticCuboidCollider(
                0.1, 0.1, 0.1,
                { x: position.x, y: position.y, z: position.z }
            );
            if (collider) {
                this.laneToggleByHandle.set(collider.id, lane);
                const body = collider.body;
                if (body) {
                    this.ownPhysicsBody(body);
                }
            }
        }
    }

    private createArpStrips(): void {
        const stripRadius = 1.8;
        const baseY = this.stationCenter.y + 0.34;
        const stripAngles: Record<TArpStripId, number> = {
            'arp-0': -0.5,
            'arp-1': 0,
            'arp-2': 0.5
        };
        const colors: Record<TArpStripId, number> = {
            'arp-0': 0x63e5ff,
            'arp-1': 0x79ffcf,
            'arp-2': 0xff8ae8
        };

        for (const stripId of ARP_STRIPS) {
            const angle = stripAngles[stripId];
            const position = new THREE.Vector3(
                this.stationCenter.x - Math.cos(angle) * stripRadius,
                baseY,
                this.stationCenter.z + Math.sin(angle) * stripRadius
            );
            this.arpStripPositions.set(stripId, position);

            if (this.group) {
                const geo = new THREE.BoxGeometry(0.5, 0.07, 0.13);
                const color = new THREE.Color(colors[stripId]);
                const mat = new THREE.MeshStandardMaterial({
                    color,
                    emissive: color.clone().multiplyScalar(0.85),
                    emissiveIntensity: 0.16,
                    metalness: 0.28,
                    roughness: 0.26
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(position);
                mesh.rotation.y = angle + Math.PI / 2;
                mesh.rotation.x = THREE.MathUtils.degToRad(-10);
                mesh.name = `drum-arp-strip:${stripId}:${this.id}`;
                mesh.add(new THREE.LineSegments(
                    new THREE.EdgesGeometry(geo),
                    new THREE.LineBasicMaterial({ color: 0x9dfcff, transparent: true, opacity: 0.48 })
                ));
                this.group.add(mesh);
                this.arpStripMeshes.set(stripId, mesh);
            }

            const collider = this.context.physics.createStaticCuboidCollider(
                0.25, 0.04, 0.07,
                { x: position.x, y: position.y, z: position.z }
            );
            if (collider) {
                this.arpStripByHandle.set(collider.id, stripId);
                const body = collider.body;
                if (body) {
                    this.ownPhysicsBody(body);
                }
            }
        }
    }

    private bindCollisionListener(): void {
        this.context.onPhysicsCollisionStarted((data) => {
            const laneA = this.laneToggleByHandle.get(data.handleA);
            const laneB = this.laneToggleByHandle.get(data.handleB);
            if (laneA || laneB) {
                const lane = laneA || laneB!;
                const entityId = laneA ? data.entityBId : data.entityAId;
                if (!entityId) return;

                const entity = this.context.entity.get(entityId) as PhysicsPropEntity | undefined;
                if (!entity || entity.type !== EntityType.PHYSICS_PROP) return;

                const v = entity.rigidBody.linvel();
                const speed = Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
                if (speed < 0.35) return;

                this.requestLaneToggle(lane);
                return;
            }

            const padA = this.padFreqByHandle.get(data.handleA);
            const padB = this.padFreqByHandle.get(data.handleB);
            if (!padA && !padB) return;

            const hit = padA || padB!;
            const entityId = padA ? data.entityBId : data.entityAId;
            if (!entityId) return;

            const entity = this.context.entity.get(entityId) as PhysicsPropEntity | undefined;
            if (!entity || entity.type !== EntityType.PHYSICS_PROP) return;

            const v = entity.rigidBody.linvel();
            const speed = Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
            const intensity = Math.max(0.08, Math.min(1.0, speed * 0.22));
            const padInfo = this.padById.get(hit.padId);

            this.applyDrumHit({
                padId: hit.padId,
                frequency: hit.frequency,
                intensity,
                position: padInfo ? { x: padInfo.position.x, y: padInfo.position.y, z: padInfo.position.z } : undefined
            }, true);
        });
    }

    private updateHandPadTouches(_delta: number): void {
        const tracking = this.context.tracking.getState?.();
        if (!tracking) {
            this.handLastPos.left = null;
            this.handLastPos.right = null;
            return;
        }
        const now = this.nowMs();
        const padEnterRadius = 0.24;
        const padLeaveRadius = 0.36;
        const touchCooldownMs = 140;

        for (const hand of ['left', 'right'] as const) {
            const state = tracking.hands[hand];
            if (!state.active || this.padPositions.length === 0) {
                this.handLastPos[hand] = null;
                continue;
            }

            const strikePose = this.getAvatarHandStrikePosition(hand);
            if (!strikePose) {
                this.handLastPos[hand] = null;
                continue;
            }

            const pos = new THREE.Vector3(strikePose.x, strikePose.y, strikePose.z);
            this.handLastPos[hand] = pos;

            for (let i = 0; i < this.padPositions.length; i++) {
                const padPos = this.padPositions[i];
                const dx = pos.x - padPos.x;
                const dz = pos.z - padPos.z;
                const distXZ = Math.hypot(dx, dz);
                const distY = Math.abs(pos.y - padPos.y);
                const armKey = `${hand}:pad:${i}`;
                const armed = this.handPadArmed.get(armKey) ?? true;
                if (distXZ > padLeaveRadius || distY > 0.24) {
                    this.handPadArmed.set(armKey, true);
                    continue;
                }
                if (!armed || distXZ > padEnterRadius) continue;
                if (distY > 0.2) continue;

                const key = `${hand}:${i}`;
                const lastHit = this.lastHandPadHitAtMs.get(key) ?? 0;
                if ((now - lastHit) < touchCooldownMs) continue;
                this.lastHandPadHitAtMs.set(key, now);
                this.handPadArmed.set(armKey, false);

                const padId = `pad-${i}` as TPadPhraseId;
                const padInfo = this.padById.get(padId);
                this.applyDrumHit({
                    padId,
                    frequency: padInfo?.frequency ?? 220,
                    intensity: 0.74,
                    position: padInfo ? { x: padInfo.position.x, y: padInfo.position.y, z: padInfo.position.z } : undefined
                }, true);
            }
        }
    }

    private updateHandToggleHits(delta: number): void {
        const tracking = this.context.tracking.getState?.();
        if (!tracking) {
            this.handLastTogglePos.left = null;
            this.handLastTogglePos.right = null;
            return;
        }

        const dt = Math.max(0.0001, delta);
        const now = this.nowMs();
        const enterRadius = 0.16;
        const leaveRadius = 0.24;
        const cooldownMs = 300;

        for (const hand of ['left', 'right'] as const) {
            const state = tracking.hands[hand];
            if (!state.active) {
                this.handLastTogglePos[hand] = null;
                continue;
            }

            const strikePose = this.getAvatarHandStrikePosition(hand);
            if (!strikePose) {
                this.handLastTogglePos[hand] = null;
                continue;
            }

            const pos = new THREE.Vector3(strikePose.x, strikePose.y, strikePose.z);
            const prev = this.handLastTogglePos[hand];
            this.handLastTogglePos[hand] = pos;
            if (!prev) continue;

            const vy = (pos.y - prev.y) / dt;
            const speed = pos.distanceTo(prev) / dt;
            if (vy > -0.05 || speed < 0.22) continue;

            for (const lane of BEAT_LANES) {
                const lanePos = this.laneTogglePositions.get(lane);
                if (!lanePos) continue;

                const dist = pos.distanceTo(lanePos);
                const armKey = `${hand}:toggle:${lane}`;
                const armed = this.handToggleArmed.get(armKey) ?? true;
                if (dist > leaveRadius) {
                    this.handToggleArmed.set(armKey, true);
                    continue;
                }
                if (!armed || dist > enterRadius) continue;

                const crossedTop = prev.y > (lanePos.y + 0.11) && pos.y <= (lanePos.y + 0.11);
                const nearTop = Math.abs(pos.y - lanePos.y) <= 0.15;
                if (!crossedTop && !nearTop) continue;

                const key = `${hand}:${lane}`;
                const lastHit = this.lastHandToggleAtMs.get(key) ?? 0;
                if ((now - lastHit) < cooldownMs) continue;
                this.lastHandToggleAtMs.set(key, now);
                this.handToggleArmed.set(armKey, false);

                this.requestLaneToggle(lane);
            }
        }
    }

    private updateHandArpTouches(): void {
        const tracking = this.context.tracking.getState?.();
        for (const hand of ['left', 'right'] as const) {
            const previousStrip = this.handActiveArpStripByHand[hand];
            const sourceId = this.getHandTouchSourceId(hand);

            if (!tracking || !tracking.hands[hand].active) {
                if (previousStrip) {
                    this.requestArpTouch(previousStrip, sourceId, false);
                    this.handActiveArpStripByHand[hand] = null;
                }
                continue;
            }

            const strikePose = this.getAvatarHandStrikePosition(hand);
            if (!strikePose) {
                if (previousStrip) {
                    this.requestArpTouch(previousStrip, sourceId, false);
                    this.handActiveArpStripByHand[hand] = null;
                }
                continue;
            }

            const pos = new THREE.Vector3(strikePose.x, strikePose.y, strikePose.z);
            const nextStrip = this.findTouchedArpStrip(pos);
            if (nextStrip === previousStrip) {
                continue;
            }

            if (previousStrip) {
                this.requestArpTouch(previousStrip, sourceId, false);
            }
            if (nextStrip) {
                this.requestArpTouch(nextStrip, sourceId, true);
            }
            this.handActiveArpStripByHand[hand] = nextStrip;
        }
    }

    private findTouchedArpStrip(handPos: THREE.Vector3): TArpStripId | null {
        let bestStrip: TArpStripId | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const stripId of ARP_STRIPS) {
            const stripPos = this.arpStripPositions.get(stripId);
            if (!stripPos) continue;
            const dy = Math.abs(handPos.y - stripPos.y);
            if (dy > 0.18) continue;
            const dx = handPos.x - stripPos.x;
            const dz = handPos.z - stripPos.z;
            const distXZ = Math.hypot(dx, dz);
            if (distXZ > 0.31) continue;
            const score = distXZ + dy * 0.6;
            if (score < bestScore) {
                bestScore = score;
                bestStrip = stripId;
            }
        }
        return bestStrip;
    }

    private requestArpTouch(stripId: TArpStripId, sourceId: string, active: boolean): void {
        if (!this.isValidArpStripId(stripId) || !sourceId) return;
        if (this.context.app.isHost) {
            const changed = this.applyArpTouchSource(stripId, sourceId, active);
            if (changed) {
                this.emitSyncEvent('arp-touch-state', { stripId, active: this.arpStripActive[stripId] } satisfies IArpTouchStatePayload);
            }
            return;
        }
        this.emitSyncEvent('arp-touch-request', { stripId, sourceId, active } satisfies IArpTouchPayload);
    }

    private applyArpTouchSource(stripId: TArpStripId, sourceId: string, active: boolean): boolean {
        let set = this.arpTouchSourcesByStrip.get(stripId);
        if (!set) {
            set = new Set<string>();
            this.arpTouchSourcesByStrip.set(stripId, set);
        }
        const wasActive = this.arpStripActive[stripId];
        if (active) set.add(sourceId);
        else set.delete(sourceId);
        const nextActive = set.size > 0;
        this.applyArpStripActive(stripId, nextActive);
        return wasActive !== nextActive;
    }

    private applyArpStripActive(stripId: TArpStripId, active: boolean): void {
        this.arpStripActive[stripId] = !!active;
        const mesh = this.arpStripMeshes.get(stripId);
        if (mesh) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = active ? Math.max(mat.emissiveIntensity, 0.6) : Math.min(mat.emissiveIntensity, 0.2);
        }
        if (active && !this.isPlaying) {
            this.isPlaying = true;
            this.sequencerAnchorMs = this.nowMs();
            this.lastProcessedAbsoluteStep = 0;
        }
    }

    private getHandTouchSourceId(hand: 'left' | 'right'): string {
        const id = this.context.tracking.getLocalPlayer()?.id || this.context.app.localPlayer?.id || 'local';
        return `${id}:${hand}`;
    }

    private requestPadPhraseTrigger(padId: TPadPhraseId): void {
        const now = this.nowMs();
        const lastAt = this.padTouchCooldownAtMs.get(padId) ?? 0;
        if ((now - lastAt) < 140) return;
        this.padTouchCooldownAtMs.set(padId, now);

        if (this.context.app.isHost) {
            this.startPadPhrase(padId);
            return;
        }

        this.emitSyncEvent('phrase-request', { padId } satisfies IPadPhraseRequestPayload);
    }

    private startPadPhrase(padId: TPadPhraseId): void {
        if (!this.isValidPadId(padId)) return;
        const now = this.nowMs();
        if (!this.isPlaying) {
            this.isPlaying = true;
            this.sequencerAnchorMs = now;
            this.lastProcessedAbsoluteStep = 0;
        }
        const stepDurationMs = this.getStepDurationMs();
        const elapsedMs = Math.max(0, now - this.sequencerAnchorMs);
        const absoluteStep = Math.floor(elapsedMs / stepDurationMs);
        const phaseMs = elapsedMs - (absoluteStep * stepDurationMs);
        const quantizedStart = phaseMs < (stepDurationMs * 0.35)
            ? absoluteStep
            : absoluteStep + 1;

        const payload: IPadPhraseStartPayload = {
            padId,
            startStep: quantizedStart
        };

        this.applyPadPhraseStart(payload);
        this.emitSyncEvent('phrase-start', payload);
    }

    private applyPadPhraseStart(start: IPadPhraseStartPayload): void {
        if (!this.isValidPadPhraseStart(start)) return;
        const stepDurationMs = this.getStepDurationMs();
        if (!this.isPlaying) {
            this.isPlaying = true;
            this.sequencerAnchorMs = this.nowMs() - (Math.max(0, Math.floor(start.startStep)) * stepDurationMs);
            this.lastProcessedAbsoluteStep = null;
        }
        this.padPhraseById.set(start.padId, {
            padId: start.padId,
            startStep: Math.max(0, Math.floor(start.startStep))
        });
        const idx = this.parsePadIndex(start.padId);
        if (idx >= 0 && idx < this.padFlash.length) {
            this.padFlash[idx] = Math.max(this.padFlash[idx], 0.9);
        }
    }

    private triggerPadPhraseNotes(absoluteStep: number): void {
        if (this.padPhraseById.size === 0) return;

        for (const [padId, phrase] of this.padPhraseById.entries()) {
            const relStep = absoluteStep - phrase.startStep;
            if (relStep < 0) continue;
            if (relStep > 15) {
                this.padPhraseById.delete(padId);
                continue;
            }

            const pattern = this.padPhrasePatternById[padId];
            if (!pattern || pattern.length === 0) continue;
            const root = this.padPhraseRootFreqById[padId];
            if (!root) continue;

            for (const note of pattern) {
                if (note.stepOffset !== relStep) continue;

                const frequency = root * Math.pow(2, note.offsetSemitones / 12);
                const padInfo = this.padById.get(padId);
                this.context.audio.playMelodyNote({
                    frequency,
                    intensity: note.intensity,
                    position: padInfo
                        ? { x: padInfo.position.x, y: padInfo.position.y + 0.08, z: padInfo.position.z }
                        : { x: this.stationCenter.x, y: this.stationCenter.y, z: this.stationCenter.z }
                });
                const idx = this.parsePadIndex(padId);
                if (idx >= 0 && idx < this.padFlash.length) {
                    this.padFlash[idx] = Math.max(this.padFlash[idx], 0.82);
                }
            }
        }
    }

    private getAvatarHandStrikePosition(hand: 'left' | 'right'): { x: number; y: number; z: number } | null {
        const trackingState = this.context.tracking.getState().hands[hand];
        const localHumanoidJoints = this.context.tracking.getLocalPlayer()?.humanoid?.joints;

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

    private applyDrumHit(hit: IDrumPadHitPayload, replicate: boolean): void {
        const idx = this.parsePadIndex(hit.padId);
        if (idx >= 0 && idx < this.padFlash.length) {
            this.padFlash[idx] = Math.max(this.padFlash[idx], Math.min(1.0, hit.intensity * 1.2));
        }

        this.context.audio.playMelodyNote({
            frequency: hit.frequency,
            intensity: hit.intensity,
            position: hit.position
        });

        if (replicate) {
            this.emitSyncEvent('hit', hit);
        }
    }

    private updateToggleVisuals(delta: number): void {
        for (const lane of BEAT_LANES) {
            const mesh = this.laneToggleMeshes.get(lane);
            if (!mesh) continue;

            const mat = mesh.material as THREE.MeshStandardMaterial;
            const pulse = this.lanePulse[lane];
            const active = this.laneEnabled[lane];
            const targetEmissive = active ? (0.62 + pulse * 1.2) : (0.12 + pulse * 0.2);
            mat.emissiveIntensity += (targetEmissive - mat.emissiveIntensity) * 0.24;

            const targetScale = active ? (1.0 + pulse * 0.22) : 0.96;
            mesh.scale.x += (targetScale - mesh.scale.x) * 0.2;
            mesh.scale.y += (targetScale - mesh.scale.y) * 0.2;
            mesh.scale.z += (targetScale - mesh.scale.z) * 0.2;

            this.lanePulse[lane] = Math.max(0, pulse - delta * 4.2);
        }

        for (const stripId of ARP_STRIPS) {
            const mesh = this.arpStripMeshes.get(stripId);
            if (!mesh) continue;
            const active = this.arpStripActive[stripId];
            const mat = mesh.material as THREE.MeshStandardMaterial;
            const target = active ? 0.72 : 0.14;
            mat.emissiveIntensity += (target - mat.emissiveIntensity) * 0.22;
            const targetScaleY = active ? 1.1 : 1.0;
            mesh.scale.y += (targetScaleY - mesh.scale.y) * 0.2;
        }
    }

    private requestLaneToggle(lane: TBeatLane): void {
        if (!this.isValidBeatLane(lane)) return;

        if (this.context.app.isHost) {
            this.toggleLane(lane);
            this.broadcastSequencerSnapshot();
            return;
        }

        this.emitSyncEvent('station-toggle', { lane } satisfies IStationTogglePayload);
    }

    private toggleLane(lane: TBeatLane): void {
        const wasAnyEnabled = this.anyLaneEnabled();
        this.laneEnabled[lane] = !this.laneEnabled[lane];
        const nowAnyEnabled = this.anyLaneEnabled();

        if (!wasAnyEnabled && nowAnyEnabled) {
            this.isPlaying = true;
            this.sequencerAnchorMs = this.nowMs();
            this.lastProcessedAbsoluteStep = 0;
            this.triggerSequencerStep(0, 0);
        } else if (wasAnyEnabled && !nowAnyEnabled) {
            this.isPlaying = false;
            this.lastProcessedAbsoluteStep = null;
        }

        this.lanePulse[lane] = Math.max(this.lanePulse[lane], 1.0);
    }

    private updateSequencer(): void {
        if (!this.isPlaying) {
            this.lastProcessedAbsoluteStep = null;
            return;
        }

        const now = this.nowMs();
        const stepDurationMs = this.getStepDurationMs();
        const elapsedMs = Math.max(0, now - this.sequencerAnchorMs);
        const absoluteStep = Math.floor(elapsedMs / stepDurationMs);
        const phaseMs = elapsedMs - (absoluteStep * stepDurationMs);

        if (this.lastProcessedAbsoluteStep === null) {
            this.lastProcessedAbsoluteStep = absoluteStep;
        } else if (absoluteStep > this.lastProcessedAbsoluteStep) {
            const deltaSteps = Math.min(absoluteStep - this.lastProcessedAbsoluteStep, 16);
            for (let i = 1; i <= deltaSteps; i++) {
                const absStep = this.lastProcessedAbsoluteStep + i;
                const step = absStep % 16;
                this.triggerSequencerStep(step, absStep);
            }
            this.lastProcessedAbsoluteStep = absoluteStep;
        }

        if (this.context.app.isHost && (now - this.lastSyncBroadcastAtMs) >= 2000) {
            this.broadcastSequencerSnapshot(absoluteStep % 16, phaseMs);
        }

        // Keep the transport alive for active phrases even if all lanes are off.
        if (!this.anyLaneEnabled() && !this.anyArpActive() && this.padPhraseById.size === 0) {
            this.isPlaying = false;
            this.lastProcessedAbsoluteStep = null;
        }
    }

    private triggerSequencerStep(step: number, absoluteStep: number): void {
        const pos = { x: this.stationCenter.x, y: this.stationCenter.y, z: this.stationCenter.z };

        if (this.laneEnabled.kick && this.lanePattern.kick.has(step)) {
            this.lanePulse.kick = Math.max(this.lanePulse.kick, 1.0);
            this.context.audio.playSequencerBeat({ beat: 'kick', intensity: 0.9, position: pos });
        }
        if (this.laneEnabled.snare && this.lanePattern.snare.has(step)) {
            this.lanePulse.snare = Math.max(this.lanePulse.snare, 0.95);
            this.context.audio.playSequencerBeat({ beat: 'snare', intensity: 0.72, position: pos });
        }
        if (this.laneEnabled.hat && this.lanePattern.hat.has(step)) {
            this.lanePulse.hat = Math.max(this.lanePulse.hat, 0.78);
            this.context.audio.playSequencerBeat({ beat: 'hat', intensity: 0.62, position: pos });
        }
        if (this.laneEnabled.bass && this.lanePattern.bass.has(step)) {
            this.lanePulse.bass = Math.max(this.lanePulse.bass, 0.9);
            this.context.audio.playSequencerBeat({ beat: 'bass', intensity: 0.72, position: pos });
        }

        this.triggerArpStep(absoluteStep);
        this.triggerPadPhraseNotes(absoluteStep);
    }

    private triggerArpStep(absoluteStep: number): void {
        const arpOffsets: Record<TArpStripId, readonly number[]> = {
            'arp-0': [0, 7, 12, 7],
            'arp-1': [0, 3, 7, 10],
            'arp-2': [0, 5, 9, 12]
        };
        const arpRoots: Record<TArpStripId, number> = {
            'arp-0': 261.63,
            'arp-1': 293.66,
            'arp-2': 329.63
        };

        for (const stripId of ARP_STRIPS) {
            if (!this.arpStripActive[stripId]) continue;
            const pattern = arpOffsets[stripId];
            const noteIdx = absoluteStep % pattern.length;
            const semitone = pattern[noteIdx];
            const freq = arpRoots[stripId] * Math.pow(2, semitone / 12);
            const pos = this.arpStripPositions.get(stripId);
            this.context.audio.playArpNote({
                frequency: freq,
                intensity: 0.62,
                position: pos ? { x: pos.x, y: pos.y, z: pos.z } : { x: this.stationCenter.x, y: this.stationCenter.y, z: this.stationCenter.z }
            });
        }
    }

    private captureSequencerSnapshot(): ISequencerSnapshot {
        const now = this.nowMs();
        const stepDurationMs = this.getStepDurationMs();
        const elapsedMs = Math.max(0, now - this.sequencerAnchorMs);
        const absoluteStep = Math.floor(elapsedMs / stepDurationMs);
        const stepPhaseMs = elapsedMs - (absoluteStep * stepDurationMs);

        return {
            version: 1,
            bpm: this.bpm,
            isPlaying: this.isPlaying,
            stepIndex: absoluteStep % 16,
            stepPhaseMs,
            laneEnabled: { ...this.laneEnabled },
            arpActive: { ...this.arpStripActive }
        };
    }

    private applySequencerSnapshot(snapshot: ISequencerSnapshot | undefined): void {
        if (!snapshot || snapshot.version !== 1) return;
        if (!this.isValidLaneEnabled(snapshot.laneEnabled)) return;
        const arpActive = this.isValidArpActive(snapshot.arpActive)
            ? snapshot.arpActive
            : ({ 'arp-0': false, 'arp-1': false, 'arp-2': false } as Record<TArpStripId, boolean>);

        this.bpm = Math.max(80, Math.min(170, snapshot.bpm || 124));
        this.laneEnabled = { ...snapshot.laneEnabled };
        this.arpStripActive['arp-0'] = !!arpActive['arp-0'];
        this.arpStripActive['arp-1'] = !!arpActive['arp-1'];
        this.arpStripActive['arp-2'] = !!arpActive['arp-2'];
        this.isPlaying = !!snapshot.isPlaying && (this.anyLaneEnabled() || this.anyArpActive());

        const stepDurationMs = this.getStepDurationMs();
        const clampedStep = this.normalizeStep(snapshot.stepIndex);
        const clampedPhase = Math.max(0, Math.min(stepDurationMs, snapshot.stepPhaseMs || 0));
        const offsetMs = (clampedStep * stepDurationMs) + clampedPhase;
        this.sequencerAnchorMs = this.nowMs() - offsetMs;
        this.lastProcessedAbsoluteStep = null;
    }

    private broadcastSequencerSnapshot(stepIndex?: number, stepPhaseMs?: number): void {
        const snapshot = this.captureSequencerSnapshot();
        if (stepIndex !== undefined) snapshot.stepIndex = this.normalizeStep(stepIndex);
        if (stepPhaseMs !== undefined) {
            snapshot.stepPhaseMs = Math.max(0, Math.min(this.getStepDurationMs(), stepPhaseMs));
        }
        this.lastSyncBroadcastAtMs = this.nowMs();
        this.emitSyncEvent('station-sync', snapshot);
    }

    private parsePadIndex(padId: string): number {
        if (!padId.startsWith('pad-')) return -1;
        const v = Number.parseInt(padId.slice(4), 10);
        return Number.isFinite(v) ? v : -1;
    }

    private isValidHit(hit: IDrumPadHitPayload | undefined): hit is IDrumPadHitPayload {
        if (!hit || typeof hit.padId !== 'string') return false;
        return typeof hit.frequency === 'number' && typeof hit.intensity === 'number';
    }

    private isValidLaneEnabled(laneEnabled: unknown): laneEnabled is Record<TBeatLane, boolean> {
        if (!laneEnabled || typeof laneEnabled !== 'object') return false;
        const v = laneEnabled as Record<string, unknown>;
        return typeof v.kick === 'boolean'
            && typeof v.snare === 'boolean'
            && typeof v.hat === 'boolean'
            && typeof v.bass === 'boolean';
    }

    private isValidToggle(toggle: IStationTogglePayload | undefined): toggle is IStationTogglePayload {
        return !!toggle && this.isValidBeatLane(toggle.lane);
    }

    private isValidPadPhraseRequest(data: IPadPhraseRequestPayload | undefined): data is IPadPhraseRequestPayload {
        return !!data && this.isValidPadId(data.padId);
    }

    private isValidPadPhraseStart(data: IPadPhraseStartPayload | undefined): data is IPadPhraseStartPayload {
        if (!data || !this.isValidPadId(data.padId)) return false;
        return Number.isFinite(data.startStep);
    }

    private isValidArpTouchPayload(data: IArpTouchPayload | undefined): data is IArpTouchPayload {
        if (!data || !this.isValidArpStripId(data.stripId)) return false;
        return typeof data.sourceId === 'string' && typeof data.active === 'boolean';
    }

    private isValidArpTouchStatePayload(data: IArpTouchStatePayload | undefined): data is IArpTouchStatePayload {
        if (!data || !this.isValidArpStripId(data.stripId)) return false;
        return typeof data.active === 'boolean';
    }

    private isValidArpStripId(stripId: unknown): stripId is TArpStripId {
        return stripId === 'arp-0' || stripId === 'arp-1' || stripId === 'arp-2';
    }

    private isValidArpActive(data: unknown): data is Record<TArpStripId, boolean> {
        if (!data || typeof data !== 'object') return false;
        const v = data as Record<string, unknown>;
        return typeof v['arp-0'] === 'boolean'
            && typeof v['arp-1'] === 'boolean'
            && typeof v['arp-2'] === 'boolean';
    }

    private isValidPadId(padId: unknown): padId is TPadPhraseId {
        if (typeof padId !== 'string') return false;
        const idx = this.parsePadIndex(padId);
        return idx >= 0 && idx <= 7;
    }

    private isValidBeatLane(lane: unknown): lane is TBeatLane {
        return lane === 'kick' || lane === 'snare' || lane === 'hat' || lane === 'bass';
    }

    private anyLaneEnabled(): boolean {
        return this.laneEnabled.kick || this.laneEnabled.snare || this.laneEnabled.hat || this.laneEnabled.bass;
    }

    private anyArpActive(): boolean {
        return this.arpStripActive['arp-0'] || this.arpStripActive['arp-1'] || this.arpStripActive['arp-2'];
    }

    private normalizeStep(stepIndex: number): number {
        if (!Number.isFinite(stepIndex)) return 0;
        const rounded = Math.floor(stepIndex);
        return ((rounded % 16) + 16) % 16;
    }

    private getStepDurationMs(): number {
        return (60_000 / this.bpm) / 4;
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}

export class DrumPadArcObject implements IObjectModule {
    public readonly id = 'drum-pad-arc';
    public readonly displayName = 'Drum Pad Arc';
    public readonly tags = ['instrument', 'interactive', 'shared'];
    public readonly networked = true;
    public readonly portable = false;

    public spawn(context: IObjectSpawnContext, _config: IObjectSpawnConfig): DrumPadArcInstance {
        return new DrumPadArcInstance(context, this.id);
    }
}
