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

type TBeatLane = 'kick' | 'snare' | 'hat';
const BEAT_LANES: TBeatLane[] = ['kick', 'snare', 'hat'];

interface IStationTogglePayload {
    lane: TBeatLane;
}

interface ISequencerSnapshot {
    version: 1;
    bpm: number;
    isPlaying: boolean;
    stepIndex: number;
    stepPhaseMs: number;
    laneEnabled: Record<TBeatLane, boolean>;
}

class DrumPadArcInstance extends BaseReplicatedObjectInstance implements IReplicatedObjectInstance {
    private readonly padMeshes: THREE.Mesh[] = [];
    private readonly padPositions: THREE.Vector3[] = [];
    private readonly padFlash: number[] = [];
    private readonly padFreqByHandle = new Map<number, { padId: string; frequency: number }>();
    private readonly padById = new Map<string, { index: number; frequency: number; position: THREE.Vector3 }>();
    private readonly handLastPos: Record<'left' | 'right', THREE.Vector3 | null> = { left: null, right: null };
    private readonly lastHandPadHitAtMs = new Map<string, number>();
    private readonly group: THREE.Group | null;

    private readonly stationCenter = new THREE.Vector3(6.2, 1.25, -1.8);
    private readonly laneToggleMeshes = new Map<TBeatLane, THREE.Mesh>();
    private readonly laneTogglePositions = new Map<TBeatLane, THREE.Vector3>();
    private readonly laneToggleByHandle = new Map<number, TBeatLane>();
    private readonly lanePulse: Record<TBeatLane, number> = { kick: 0, snare: 0, hat: 0 };
    private readonly lanePattern: Record<TBeatLane, ReadonlySet<number>> = {
        kick: new Set([0, 4, 8, 12]),
        snare: new Set([4, 12]),
        hat: new Set([2, 6, 10, 14])
    };
    private laneEnabled: Record<TBeatLane, boolean> = {
        kick: true,
        snare: true,
        hat: true
    };
    private bpm: number = 124;
    private isPlaying: boolean = true;
    private sequencerAnchorMs: number = 0;
    private lastProcessedAbsoluteStep: number | null = null;
    private lastSyncBroadcastAtMs: number = 0;

    private readonly handLastTogglePos: Record<'left' | 'right', THREE.Vector3 | null> = { left: null, right: null };
    private readonly lastHandToggleAtMs = new Map<string, number>();

    constructor(context: IObjectSpawnContext, moduleId: string) {
        super(context, moduleId);
        this.group = this.context.app.runtime.render ? this.ownSceneObject(new THREE.Group()) : null;
        this.sequencerAnchorMs = this.nowMs();

        if (this.group) {
            this.group.name = `drum-pad-arc:${this.id}`;
        }

        this.createDrumPads();
        this.createLaneToggles();
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
        this.updateHandDrumHits(delta);
        this.updateHandToggleHits(delta);
    }

    public destroy(): void {
        this.padFreqByHandle.clear();
        this.padById.clear();
        this.padPositions.length = 0;
        this.padFlash.length = 0;
        this.lastHandPadHitAtMs.clear();
        this.lastHandToggleAtMs.clear();
        this.handLastPos.left = null;
        this.handLastPos.right = null;
        this.handLastTogglePos.left = null;
        this.handLastTogglePos.right = null;
        this.padMeshes.length = 0;
        this.laneToggleMeshes.clear();
        this.laneTogglePositions.clear();
        this.laneToggleByHandle.clear();
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
        const radius = 1.85;
        const center = new THREE.Vector3(6.2, 1.1, -1.8);
        this.stationCenter.set(center.x, center.y + 0.16, center.z);

        for (let i = 0; i < padCount; i++) {
            const t = (i / (padCount - 1));
            const angle = THREE.MathUtils.lerp(-0.95, 0.95, t);
            const px = center.x - Math.cos(angle) * radius;
            const pz = center.z + Math.sin(angle) * radius;
            const padY = center.y;

            if (this.group) {
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
                this.group.add(pad);
                this.padMeshes.push(pad);
            }

            const position = new THREE.Vector3(px, padY, pz);
            this.padPositions.push(position);
            this.padFlash.push(0);
            this.padById.set(`pad-${i}`, { index: i, frequency: notes[i], position });

            const collider = this.context.physics.createStaticCuboidCollider(
                0.21, 0.04, 0.21,
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
        const baseY = this.stationCenter.y + 0.58;
        const baseZ = this.stationCenter.z - 0.18;
        const xOffsets: Record<TBeatLane, number> = {
            kick: -0.58,
            snare: 0,
            hat: 0.58
        };
        const colors: Record<TBeatLane, number> = {
            kick: 0xff4b6e,
            snare: 0x30d0ff,
            hat: 0xffd447
        };

        for (const lane of BEAT_LANES) {
            const position = new THREE.Vector3(this.stationCenter.x + xOffsets[lane], baseY, baseZ);
            this.laneTogglePositions.set(lane, position);

            if (this.group) {
                const geo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
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
                mesh.name = `drum-lane-toggle:${lane}:${this.id}`;
                mesh.add(new THREE.LineSegments(
                    new THREE.EdgesGeometry(geo),
                    new THREE.LineBasicMaterial({ color: 0x7fffff, transparent: true, opacity: 0.5 })
                ));
                this.group.add(mesh);
                this.laneToggleMeshes.set(lane, mesh);
            }

            const collider = this.context.physics.createStaticCuboidCollider(
                0.12, 0.12, 0.12,
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

    private updateHandDrumHits(delta: number): void {
        const tracking = this.context.tracking.getState?.();
        if (!tracking) {
            this.handLastPos.left = null;
            this.handLastPos.right = null;
            return;
        }
        const dt = Math.max(0.0001, delta);
        const now = this.nowMs();
        const padRadius = 0.27;
        const strikeCooldownMs = 120;

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
            const prev = this.handLastPos[hand];
            this.handLastPos[hand] = pos;
            if (!prev) continue;

            const vx = (pos.x - prev.x) / dt;
            const vy = (pos.y - prev.y) / dt;
            const vz = (pos.z - prev.z) / dt;
            const speed = Math.hypot(vx, vy, vz);
            if (vy > -0.08 || speed < 0.28) continue;

            for (let i = 0; i < this.padPositions.length; i++) {
                const padPos = this.padPositions[i];
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
                const freq = this.padById.get(`pad-${i}`)?.frequency ?? 220;
                this.applyDrumHit({
                    padId: `pad-${i}`,
                    frequency: freq,
                    intensity,
                    position: { x: padPos.x, y: padPos.y, z: padPos.z }
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
        const radius = 0.2;
        const cooldownMs = 260;

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

                if (pos.distanceTo(lanePos) > radius) continue;

                const crossedTop = prev.y > (lanePos.y + 0.11) && pos.y <= (lanePos.y + 0.11);
                const nearTop = Math.abs(pos.y - lanePos.y) <= 0.15;
                if (!crossedTop && !nearTop) continue;

                const key = `${hand}:${lane}`;
                const lastHit = this.lastHandToggleAtMs.get(key) ?? 0;
                if ((now - lastHit) < cooldownMs) continue;
                this.lastHandToggleAtMs.set(key, now);

                this.requestLaneToggle(lane);
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

        this.context.audio.playDrumPadHit({
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
        this.laneEnabled[lane] = !this.laneEnabled[lane];
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
                const step = (this.lastProcessedAbsoluteStep + i) % 16;
                this.triggerSequencerStep(step);
            }
            this.lastProcessedAbsoluteStep = absoluteStep;
        }

        if (this.context.app.isHost && (now - this.lastSyncBroadcastAtMs) >= 2000) {
            this.broadcastSequencerSnapshot(absoluteStep % 16, phaseMs);
        }
    }

    private triggerSequencerStep(step: number): void {
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
            laneEnabled: { ...this.laneEnabled }
        };
    }

    private applySequencerSnapshot(snapshot: ISequencerSnapshot | undefined): void {
        if (!snapshot || snapshot.version !== 1) return;
        if (!this.isValidLaneEnabled(snapshot.laneEnabled)) return;

        this.bpm = Math.max(80, Math.min(170, snapshot.bpm || 124));
        this.isPlaying = !!snapshot.isPlaying;
        this.laneEnabled = { ...snapshot.laneEnabled };

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
            && typeof v.hat === 'boolean';
    }

    private isValidToggle(toggle: IStationTogglePayload | undefined): toggle is IStationTogglePayload {
        return !!toggle && this.isValidBeatLane(toggle.lane);
    }

    private isValidBeatLane(lane: unknown): lane is TBeatLane {
        return lane === 'kick' || lane === 'snare' || lane === 'hat';
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
