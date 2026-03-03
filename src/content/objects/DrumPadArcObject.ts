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

class DrumPadArcInstance extends BaseReplicatedObjectInstance implements IReplicatedObjectInstance {
    private readonly padMeshes: THREE.Mesh[] = [];
    private readonly padPositions: THREE.Vector3[] = [];
    private readonly padFlash: number[] = [];
    private readonly padFreqByHandle = new Map<number, { padId: string; frequency: number }>();
    private readonly padById = new Map<string, { index: number; frequency: number; position: THREE.Vector3 }>();
    private readonly handLastPos: Record<'left' | 'right', THREE.Vector3 | null> = { left: null, right: null };
    private readonly lastHandPadHitAtMs = new Map<string, number>();
    private readonly group: THREE.Group | null;

    constructor(context: IObjectSpawnContext, moduleId: string) {
        super(context, moduleId);
        this.group = this.context.app.runtime.render ? this.ownSceneObject(new THREE.Group()) : null;

        if (this.group) {
            this.group.name = `drum-pad-arc:${this.id}`;
        }

        this.createDrumPads();
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

        this.updateHandDrumHits(delta);
    }

    public destroy(): void {
        this.padFreqByHandle.clear();
        this.padById.clear();
        this.padPositions.length = 0;
        this.padFlash.length = 0;
        this.lastHandPadHitAtMs.clear();
        this.handLastPos.left = null;
        this.handLastPos.right = null;
        this.padMeshes.length = 0;
        super.destroy();
    }

    public onReplicationEvent(eventType: string, data: unknown, _meta: IObjectReplicationMeta): void {
        if (eventType !== 'hit') return;
        const hit = data as IDrumPadHitPayload;
        if (!this.isValidHit(hit)) return;
        this.applyDrumHit(hit, false);
    }

    private createDrumPads(): void {
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
                this.padFreqByHandle.set(collider.handle, { padId: `pad-${i}`, frequency: notes[i] });
                const body = collider.parent();
                if (body) {
                    this.ownPhysicsBody(body);
                }
            }
        }
    }

    private bindCollisionListener(): void {
        this.context.onPhysicsCollisionStarted((data) => {
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
        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
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

    private parsePadIndex(padId: string): number {
        if (!padId.startsWith('pad-')) return -1;
        const v = Number.parseInt(padId.slice(4), 10);
        return Number.isFinite(v) ? v : -1;
    }

    private isValidHit(hit: IDrumPadHitPayload | undefined): hit is IDrumPadHitPayload {
        if (!hit || typeof hit.padId !== 'string') return false;
        return typeof hit.frequency === 'number' && typeof hit.intensity === 'number';
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
