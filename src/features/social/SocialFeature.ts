import * as THREE from 'three';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { AppContext } from '../../app/AppContext';
import { IReplicatedFeature } from '../../network/replication/FeatureReplicationService';
import { EntityType } from '../../shared/contracts/IEntityState';
import { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import { ParticleEffectSystem } from '../../render/effects/ParticleEffectSystem';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';

type Handedness = 'left' | 'right';

interface IHighFiveEventPayload {
    a: string;
    b: string;
    ah: Handedness;
    bh: Handedness;
    p: [number, number, number];
    i: number;
}

export class SocialFeature implements IUpdatable, IReplicatedFeature {
    public readonly featureId: string = 'feature:social';

    private readonly hitDistance = 0.13;
    private readonly rearmDistance = 0.24;
    private readonly cooldownMs = 650;
    private readonly minClosingSpeed = 0.18;
    private readonly tmpMid = new THREE.Vector3();

    private lastLocalHandPos: Record<Handedness, THREE.Vector3 | null> = { left: null, right: null };
    private localHandSpeed: Record<Handedness, number> = { left: 0, right: 0 };
    private pairLastDistance: Map<string, number> = new Map();
    private pairArmed: Map<string, boolean> = new Map();
    private pairLastTriggerAt: Map<string, number> = new Map();

    constructor(private context: AppContext, private particles: ParticleEffectSystem) {
        this.context.runtime.replication.registerFeature(this);
    }

    public update(delta: number): void {
        const localId = this.context.localPlayer?.id;
        if (!localId || delta <= 0) return;

        const localLeft = this.getLocalHandPosition('left');
        const localRight = this.getLocalHandPosition('right');
        this.updateLocalHandVelocity('left', localLeft, delta);
        this.updateLocalHandVelocity('right', localRight, delta);

        if (!localLeft && !localRight) return;

        const entities = this.context.runtime.entity.entities;
        for (const entity of entities.values()) {
            if (entity.type !== EntityType.PLAYER_AVATAR) continue;
            const remote = entity as PlayerAvatarEntity;
            if (remote.controlMode !== 'remote') continue;
            const remoteId = remote.id;
            if (!remoteId || localId >= remoteId) continue; // single emitter rule

            const remoteLeft = this.getRemoteHandPosition(remote, 'left');
            const remoteRight = this.getRemoteHandPosition(remote, 'right');
            this.tryPair(localId, remoteId, 'left', 'left', localLeft, remoteLeft, delta);
            this.tryPair(localId, remoteId, 'left', 'right', localLeft, remoteRight, delta);
            this.tryPair(localId, remoteId, 'right', 'left', localRight, remoteLeft, delta);
            this.tryPair(localId, remoteId, 'right', 'right', localRight, remoteRight, delta);
        }
    }

    public onEvent(eventType: string, data: unknown): void {
        if (eventType !== 'highfive') return;
        const hit = data as IHighFiveEventPayload;
        if (!hit || !hit.p || hit.p.length < 3) return;
        this.playHighFive(hit);
    }

    private tryPair(
        localId: string,
        remoteId: string,
        localHand: Handedness,
        remoteHand: Handedness,
        localPos: THREE.Vector3 | null,
        remotePos: THREE.Vector3 | null,
        delta: number
    ): void {
        if (!localPos || !remotePos) return;

        const key = `${remoteId}:${localHand}:${remoteHand}`;
        const dist = localPos.distanceTo(remotePos);
        const lastDist = this.pairLastDistance.get(key) ?? dist;
        this.pairLastDistance.set(key, dist);

        const closingSpeed = Math.max(0, (lastDist - dist) / Math.max(0.0001, delta));
        if (dist > this.rearmDistance) {
            this.pairArmed.set(key, true);
            return;
        }

        const armed = this.pairArmed.get(key) ?? true;
        if (!armed || dist > this.hitDistance || closingSpeed < this.minClosingSpeed) return;

        const now = this.nowMs();
        const lastHit = this.pairLastTriggerAt.get(key) ?? 0;
        if ((now - lastHit) < this.cooldownMs) return;
        this.pairLastTriggerAt.set(key, now);
        this.pairArmed.set(key, false);

        const speed = this.localHandSpeed[localHand];
        const intensity = Math.min(1.0, Math.max(0.25, (speed * 0.35) + (closingSpeed * 0.45)));
        this.tmpMid.copy(localPos).add(remotePos).multiplyScalar(0.5);

        const payload: IHighFiveEventPayload = {
            a: localId,
            b: remoteId,
            ah: localHand,
            bh: remoteHand,
            p: [this.tmpMid.x, this.tmpMid.y, this.tmpMid.z],
            i: intensity
        };
        this.context.runtime.replication.emitFeatureEvent(this.featureId, 'highfive', payload);
    }

    private playHighFive(hit: IHighFiveEventPayload): void {
        const position = { x: hit.p[0], y: hit.p[1], z: hit.p[2] };
        eventBus.emit(EVENTS.SOCIAL_HIGH_FIVE, {
            position,
            intensity: hit.i,
            playerA: hit.a,
            playerB: hit.b
        });

        this.particles.spawnBurst({
            position,
            color: 0x00ffff,
            count: 22 + Math.floor(hit.i * 16),
            speed: 0.24 + hit.i * 0.34,
            lifetime: 0.12 + hit.i * 0.12,
            size: 0.010 + hit.i * 0.007
        });
        this.particles.spawnBurst({
            position,
            color: 0xff2ea6,
            count: 12 + Math.floor(hit.i * 10),
            speed: 0.2 + hit.i * 0.28,
            lifetime: 0.1 + hit.i * 0.1,
            size: 0.008 + hit.i * 0.006
        });
        this.particles.spawnBurst({
            position,
            color: 0xffffff,
            count: 6 + Math.floor(hit.i * 5),
            speed: 0.1 + hit.i * 0.18,
            lifetime: 0.055 + hit.i * 0.045,
            size: 0.022 + hit.i * 0.014
        });
    }

    private getLocalHandPosition(hand: Handedness): THREE.Vector3 | null {
        const tracking = this.context.runtime.tracking.getState().hands[hand];
        if (!tracking.active) return null;

        if (tracking.hasJoints) {
            const tip = tracking.joints[9]?.pose.position;
            if (tip && (tip.x !== 0 || tip.y !== 0 || tip.z !== 0)) {
                return new THREE.Vector3(tip.x, tip.y, tip.z);
            }
        }

        const wristName = hand === 'left' ? 'leftHand' : 'rightHand';
        const wristPose = this.context.localPlayer?.humanoid.joints[wristName]?.position;
        if (wristPose && (wristPose.x !== 0 || wristPose.y !== 0 || wristPose.z !== 0)) {
            return new THREE.Vector3(wristPose.x, wristPose.y, wristPose.z);
        }

        const pose = tracking.pose.position;
        if (pose && (pose.x !== 0 || pose.y !== 0 || pose.z !== 0)) {
            return new THREE.Vector3(pose.x, pose.y, pose.z);
        }
        return null;
    }

    private getRemoteHandPosition(remote: PlayerAvatarEntity, hand: Handedness): THREE.Vector3 | null {
        const tipName = hand === 'left' ? 'leftIndexTip' : 'rightIndexTip';
        const wristName = hand === 'left' ? 'leftHand' : 'rightHand';
        const tip = remote.humanoid.joints[tipName]?.position;
        if (tip && (tip.x !== 0 || tip.y !== 0 || tip.z !== 0)) {
            return new THREE.Vector3(tip.x, tip.y, tip.z);
        }
        const wrist = remote.humanoid.joints[wristName]?.position;
        if (wrist && (wrist.x !== 0 || wrist.y !== 0 || wrist.z !== 0)) {
            return new THREE.Vector3(wrist.x, wrist.y, wrist.z);
        }
        return null;
    }

    private updateLocalHandVelocity(hand: Handedness, pos: THREE.Vector3 | null, delta: number): void {
        const prev = this.lastLocalHandPos[hand];
        if (!pos) {
            this.lastLocalHandPos[hand] = null;
            this.localHandSpeed[hand] = 0;
            return;
        }
        if (!prev || delta <= 0) {
            this.lastLocalHandPos[hand] = pos;
            this.localHandSpeed[hand] = 0;
            return;
        }
        this.localHandSpeed[hand] = pos.distanceTo(prev) / delta;
        this.lastLocalHandPos[hand] = pos;
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
