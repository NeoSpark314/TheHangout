import * as THREE from 'three';
import type { IEntity } from '../../../shared/contracts/IEntity';
import type { IHoldable } from '../../../shared/contracts/IHoldable';
import type { IInteractable } from '../../../shared/contracts/IInteractable';
import type { IInteractionEvent } from '../../../shared/contracts/IInteractionEvent';
import type { IVector3 } from '../../../shared/contracts/IMath';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../../contracts/IObjectModule';
import type { IAudioEmitterHandle, ISharedPropPhysicsTuning } from '../../contracts/IObjectRuntimeContext';
import type { ILocalMountBinding } from '../../contracts/IMounting';
import type { IObjectReplicationMeta } from '../../contracts/IReplicatedObjectInstance';
import { BaseReplicatedPhysicsPropObjectInstance } from '../../runtime/BaseReplicatedPhysicsPropObjectInstance';
import {
    AuthoritativeSingleMountReplicator,
    type IAuthoritativeSingleMountEventMap
} from '../../runtime/AuthoritativeSingleMountReplicator';
import { ObjectRuntimeContext } from '../../runtime/ObjectRuntimeContext';
import { SIMPLE_RACING_ASSETS } from './SimpleRacingAssets';

const CAR_EVENT_OCCUPANCY = 'occupancy';
const CAR_EVENT_MOUNT_REQUEST = 'mount-request';
const CAR_EVENT_MOUNT_RELEASE_REQUEST = 'mount-release-request';
const CAR_EVENT_MOUNT_REJECTED = 'mount-rejected';
const CAR_EVENT_VISUAL_STATE = 'visual-state';
const CAR_EVENT_IMPACT = 'impact';

const CAR_MOUNT_EVENTS: IAuthoritativeSingleMountEventMap = {
    occupancy: CAR_EVENT_OCCUPANCY,
    mountRequest: CAR_EVENT_MOUNT_REQUEST,
    mountReleaseRequest: CAR_EVENT_MOUNT_RELEASE_REQUEST,
    mountRejected: CAR_EVENT_MOUNT_REJECTED
};

const CAR_RADIUS = 0.78;
const CAR_SEAT_OFFSET = new THREE.Vector3(0, 0.5, 0.6);
const CAR_BODY_YAW_OFFSET = new THREE.Vector3(0, 0, 0);
const CAR_VIEW_OFFSET = new THREE.Vector3(0, 1.0, 0.6);
const CAR_EXIT_OFFSET = new THREE.Vector3(1.35, 0.15, 0);
const CAR_VISUAL_HEIGHT_OFFSET = -CAR_RADIUS;
const CAR_VISUAL_GROUND_BIAS = -0.08;
const CAR_MOUNT_ZONE_OFFSET = new THREE.Vector3(0, 0.45, 0.02);
const CAR_MOUNT_ZONE_SIZE = new THREE.Vector3(1.45, 0.95, 2.35);
const CAR_RESET_FALL_Y = -6;
const CAR_MAX_DRIVE_DISTANCE = 140;
const CAR_STEER_RATE = 4.0;
const CAR_STEER_RESPONSE = 4.0;
const CAR_LINEAR_DAMP = 0.1;
const CAR_SPEED_SCALE = 12.5;
const CAR_DRIVE_ANGULAR_ACCEL = 100;
const CAR_VISUAL_SYNC_INTERVAL_MS = 90;
const CAR_FACING_YAW_DAMP = 14.0;
const CAR_STEER_VISUAL_DAMP = 12.0;
const CAR_BODY_FLOAT_HEIGHT = 0.35;
const CAR_ENGINE_BASE_VOLUME = 0.05;
const CAR_ENGINE_MAX_VOLUME = 0.5;
const CAR_ENGINE_LERP_RATE = 5.0;
const CAR_ENGINE_BASE_RATE = 0.5;
const CAR_ENGINE_MAX_RATE = 3.0;
const CAR_ENGINE_RATE_LERP = 2.0;
const CAR_SKID_MIN_DRIFT = 2.0;
const CAR_SKID_MAX_DRIFT = 3.0;
const CAR_SKID_MIN_VOLUME = 0.1;
const CAR_SKID_MAX_VOLUME = 0.6;
const CAR_SKID_VOLUME_LERP = 10.0;
const CAR_SKID_MIN_RATE = 1.0;
const CAR_SKID_MAX_RATE = 3.0;
const CAR_IMPACT_SPEED_THRESHOLD = 1.75;
const CAR_IMPACT_COOLDOWN_MS = 180;
const CAR_PHYSICS_TUNING: ISharedPropPhysicsTuning = {
    linearDamping: 0.1,
    angularDamping: 4.0,
    friction: 5.0,
    restitution: 0.1,
    density: 1700,
    gravityScale: 1.5,
    canSleep: true,
    startSleeping: true
};

interface ISimpleRacingCarSnapshot {
    occupiedBy: string | null;
    facingYaw: number;
    steer: number;
    speed: number;
    acceleration: number;
    wheelSpin: number;
    throttle: number;
    driftIntensity: number;
}

interface ISimpleRacingCarVisualState {
    facingYaw: number;
    steer: number;
    speed: number;
    acceleration: number;
    wheelSpin: number;
    throttle: number;
    driftIntensity: number;
}

interface ISimpleRacingCarImpactEvent {
    position: IVector3;
    intensity: number;
}

class RacingCarSeatEntity implements IEntity, IHoldable, IInteractable {
    public readonly type = 'SIMPLE_RACING_CAR_SEAT';
    public readonly isHoldable = true;
    public heldBy: string | null = null;
    public isAuthority = true;
    public isDestroyed = false;

    constructor(
        public readonly id: string,
        private readonly owner: SimpleRacingCarInstance,
        public readonly mesh: THREE.Object3D
    ) {
        this.mesh.name = `simple-racing-car-seat:${id}`;
        this.mesh.userData.entityId = id;
    }

    public update(): void { }

    public destroy(): void {
        this.isDestroyed = true;
    }

    public onHoverEnter(): void { }

    public onHoverExit(): void { }

    public onGrab(playerId: string, _hand: 'left' | 'right'): void {
        this.heldBy = playerId;
    }

    public onRelease(_velocity?: IVector3): void {
        this.heldBy = null;
    }

    public onInteraction(event: IInteractionEvent): void {
        this.owner.handleInteraction(event);
    }

    public getGrabRadius(): number {
        return 0.45;
    }

    public getHoldReleaseDistance(): number {
        return 0.3;
    }
}

export class SimpleRacingCarInstance extends BaseReplicatedPhysicsPropObjectInstance {
    private readonly runtimeContext: ObjectRuntimeContext;
    private readonly root: THREE.Group;
    private readonly visualRig = new THREE.Group();
    private readonly mountZone: THREE.Mesh;
    private readonly seatEntity: RacingCarSeatEntity;
    private readonly mountReplication: AuthoritativeSingleMountReplicator;
    private readonly spawnPosition: THREE.Vector3;
    private readonly spawnYaw: number;
    private facingYaw: number;
    private presentFacingYaw: number;
    private linearSpeed = 0;
    private angularSpeed = 0;
    private accelerationVisual = 0;
    private steerVisual = 0;
    private presentSteerVisual = 0;
    private speedVisual = 0;
    private wheelSpin = 0;
    private throttleVisual = 0;
    private driftIntensity = 0;
    private bodyNode: THREE.Object3D | null = null;
    private wheelFL: THREE.Object3D | null = null;
    private wheelFR: THREE.Object3D | null = null;
    private wheelBL: THREE.Object3D | null = null;
    private wheelBR: THREE.Object3D | null = null;
    private engineEmitter: IAudioEmitterHandle | null = null;
    private skidEmitter: IAudioEmitterHandle | null = null;
    private engineVolume = 0;
    private engineRate = 1;
    private skidVolume = 0;
    private skidRate = 1;
    private lastVisualSyncAtMs = 0;
    private lastImpactSoundAtMs = 0;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        const root = new THREE.Group();
        root.name = 'simple-racing-car';
        const position = config.position ?? { x: 0, y: 0.7, z: 0 };
        const spawnYaw = typeof config.rotationY === 'number' ? config.rotationY : 0;
        const entityId = (typeof config.entityId === 'string' && config.entityId.length > 0)
            ? config.entityId
            : (typeof config.id === 'string' && config.id.length > 0 ? `${config.id}:body` : undefined);

        super(context, 'simple-racing-car', {
            shape: 'sphere',
            radius: CAR_RADIUS,
            position,
            mesh: root,
            entityId,
            ownerId: null,
            grabbable: false,
            physicsTuning: CAR_PHYSICS_TUNING,
            replicationProfileId: 'default-prop'
        });

        this.runtimeContext = context as ObjectRuntimeContext;
        this.root = root;
        this.spawnPosition = new THREE.Vector3(position.x, position.y, position.z);
        this.spawnYaw = spawnYaw;
        this.facingYaw = spawnYaw;
        this.presentFacingYaw = spawnYaw;

        this.visualRig.position.set(position.x, position.y + CAR_VISUAL_HEIGHT_OFFSET, position.z);

        this.mountZone = this.createMountZone();
        this.visualRig.add(this.mountZone);
        this.seatEntity = new RacingCarSeatEntity(`${this.id}:seat`, this, this.mountZone);

        this.mountReplication = new AuthoritativeSingleMountReplicator(
            {
                context: this.runtimeContext,
                ownerInstanceId: this.id,
                mountPointId: 'driver',
                mountLabel: 'car',
                createLocalMountBinding: () => this.createLocalMountBinding(),
                canMount: (playerId, occupiedBy) => !occupiedBy || occupiedBy === playerId
            },
            (eventType, data, options) => this.emitSyncEvent(eventType, data as Record<string, unknown>, options),
            CAR_MOUNT_EVENTS
        );

        if (this.runtimeContext.scene.isRenderingAvailable()) {
            this.runtimeContext.scene.add(this.visualRig);
        }

        this.addCleanup(() => {
            if (this.runtimeContext.scene.isRenderingAvailable()) {
                this.runtimeContext.scene.remove(this.visualRig);
            }
        });

        this.runtimeContext.events.onCollisionStarted((event) => this.handleCollisionStarted(event));
        void this.loadVisuals();
        void this.initializeAudio();
    }

    public override getPrimaryEntity(): IEntity {
        return this.seatEntity;
    }

    public getOwnedEntityIds(): string[] {
        return this.propHandle ? [this.propHandle.entityId] : [];
    }

    public override update(delta: number): void {
        const localPlayerId = this.runtimeContext.getLocalPlayerPeerId();
        if (this.mountReplication.getOccupiedBy() === localPlayerId && !this.runtimeContext.isMountedLocal(this.id)) {
            const mountStatus = this.runtimeContext.getLocalMountStatus();
            if (mountStatus.state === 'idle' && mountStatus.reason === 'movement') {
                this.mountReplication.requestAuthoritativeReleaseForLocal('movement');
            }
        }

        this.updateDriving(delta, localPlayerId);
        this.updateVisualRig(delta);
    }

    public override onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void {
        if (this.mountReplication.handleReplicationEvent(eventType, data, meta)) {
            return;
        }

        if (eventType === CAR_EVENT_VISUAL_STATE) {
            this.applyVisualState(data);
            return;
        }

        if (eventType === CAR_EVENT_IMPACT) {
            void this.playImpactFromEvent(data);
        }
    }

    public override captureReplicationSnapshot(): unknown {
        return {
            occupiedBy: this.mountReplication.getOccupiedBy(),
            facingYaw: this.facingYaw,
            steer: this.steerVisual,
            speed: this.speedVisual,
            acceleration: this.accelerationVisual,
            wheelSpin: this.wheelSpin,
            throttle: this.throttleVisual,
            driftIntensity: this.driftIntensity
        } satisfies ISimpleRacingCarSnapshot;
    }

    public override applyReplicationSnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as Partial<ISimpleRacingCarSnapshot>;
        if (payload.occupiedBy !== undefined && payload.occupiedBy !== null && typeof payload.occupiedBy !== 'string') {
            return;
        }

        this.mountReplication.applySnapshot({ occupiedBy: payload.occupiedBy ?? null });
        this.applyVisualState(payload);
    }

    public handleInteraction(event: IInteractionEvent): void {
        if (event.type !== 'trigger' || event.phase !== 'start') return;

        if (this.mountReplication.getOccupiedBy() === event.playerId) {
            this.releaseDrivingAuthorityIfLocal();
            this.mountReplication.unmount(event.playerId, 'released');
            return;
        }

        this.mountReplication.mount(event.playerId);
    }

    private async loadVisuals(): Promise<void> {
        if (!this.runtimeContext.scene.isRenderingAvailable()) return;
        const model = await this.runtimeContext.assets.loadGLTF(SIMPLE_RACING_ASSETS.models.car);
        model.rotation.y = Math.PI;
        model.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
        });

        this.bindVisualNodes(model);
        this.visualRig.add(model);
    }

    private async initializeAudio(): Promise<void> {
        if (!this.runtimeContext.scene.isRenderingAvailable()) return;

        this.engineEmitter = await this.runtimeContext.audio.createEmitter({
            url: SIMPLE_RACING_ASSETS.audio.engine,
            loop: true,
            autoplay: true,
            position: this.getAudioPosition(),
            volume: 0,
            playbackRate: 1,
            refDistance: 2.5,
            maxDistance: 40,
            rolloffFactor: 1
        });
        this.engineVolume = 0;
        this.engineRate = 1;
        this.addCleanup(() => {
            this.engineEmitter?.dispose();
            this.engineEmitter = null;
        });

        this.skidEmitter = await this.runtimeContext.audio.createEmitter({
            url: SIMPLE_RACING_ASSETS.audio.skid,
            loop: true,
            autoplay: true,
            position: this.getAudioPosition(),
            volume: 0,
            playbackRate: 1,
            refDistance: 2.5,
            maxDistance: 34,
            rolloffFactor: 1
        });
        this.skidVolume = 0;
        this.skidRate = 1;
        this.addCleanup(() => {
            this.skidEmitter?.dispose();
            this.skidEmitter = null;
        });
    }

    private createMountZone(): THREE.Mesh {
        const geometry = new THREE.BoxGeometry(
            CAR_MOUNT_ZONE_SIZE.x,
            CAR_MOUNT_ZONE_SIZE.y,
            CAR_MOUNT_ZONE_SIZE.z
        );
        const material = new THREE.MeshBasicMaterial({
            visible: false,
            transparent: true,
            opacity: 0
        });
        const mountZone = new THREE.Mesh(geometry, material);
        mountZone.name = 'simple-racing-car-mount-zone';
        mountZone.position.copy(CAR_MOUNT_ZONE_OFFSET);
        mountZone.renderOrder = -1000;
        return mountZone;
    }

    private bindVisualNodes(model: THREE.Object3D): void {
        model.traverse((child) => {
            const name = child.name.toLowerCase();
            if (name === 'body') {
                child.rotation.order = 'YXZ';
                this.bodyNode = child;
            } else if (name.includes('wheel')) {
                child.rotation.order = 'YXZ';
                if (name.includes('front') && name.includes('left')) this.wheelFL = child;
                if (name.includes('front') && name.includes('right')) this.wheelFR = child;
                if (name.includes('back') && name.includes('left')) this.wheelBL = child;
                if (name.includes('back') && name.includes('right')) this.wheelBR = child;
            }
        });
    }

    private updateDriving(delta: number, localPlayerId: string | null): void {
        if (!localPlayerId || this.mountReplication.getOccupiedBy() !== localPlayerId || !this.runtimeContext.isMountedLocal(this.id) || !this.propHandle) {
            return;
        }

        const authorityGranted = this.propHandle.requestControl();
        if (!authorityGranted || !this.propHandle.isAuthority()) return;

        const position = this.propHandle.getPosition();
        if (!position) return;

        if (position.y < CAR_RESET_FALL_Y || Math.hypot(position.x - this.spawnPosition.x, position.z - this.spawnPosition.z) > CAR_MAX_DRIVE_DISTANCE) {
            this.resetCar();
            return;
        }

        const velocity = this.propHandle.getLinearVelocity() ?? { x: 0, y: 0, z: 0 };
        const angularVelocity = this.propHandle.getAngularVelocity() ?? { x: 0, y: 0, z: 0 };
        const input = this.runtimeContext.input.getMovementVector();
        const steeringInput = -input.x;
        const throttleInput = input.y;
        this.throttleVisual = throttleInput;

        let direction = Math.sign(this.linearSpeed);
        if (direction === 0) {
            direction = Math.abs(throttleInput) > 0.1 ? Math.sign(throttleInput) : 1;
        }

        const steeringGrip = THREE.MathUtils.clamp(Math.abs(this.linearSpeed), 0.2, 1.0);
        const targetAngular = -steeringInput * steeringGrip * CAR_STEER_RATE * direction;
        this.angularSpeed = THREE.MathUtils.lerp(this.angularSpeed, targetAngular, delta * CAR_STEER_RESPONSE);
        this.facingYaw += this.angularSpeed * delta;

        if (throttleInput < 0 && this.linearSpeed > 0.01) {
            this.linearSpeed = THREE.MathUtils.lerp(this.linearSpeed, 0, delta * 8);
        } else if (throttleInput < 0) {
            this.linearSpeed = THREE.MathUtils.lerp(this.linearSpeed, throttleInput / 2, delta * 2);
        } else {
            this.linearSpeed = THREE.MathUtils.lerp(this.linearSpeed, throttleInput, delta * 6);
        }
        this.linearSpeed *= Math.max(0, 1 - CAR_LINEAR_DAMP * delta);

        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw).setY(0).normalize();
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw).setY(0).normalize();
        const drive = this.linearSpeed * CAR_DRIVE_ANGULAR_ACCEL * delta;
        this.steerVisual = steeringInput;
        this.accelerationVisual = THREE.MathUtils.lerp(
            this.accelerationVisual,
            this.linearSpeed + (0.25 * this.linearSpeed * Math.abs(this.linearSpeed)),
            delta
        );
        this.speedVisual = this.linearSpeed;
        this.wheelSpin += this.accelerationVisual;
        const planarSpeed = Math.hypot(velocity.x, velocity.z);
        const forwardSpeed = (velocity.x * forward.x) + (velocity.z * forward.z);
        const lateralSpeed = (velocity.x * right.x) + (velocity.z * right.z);
        this.driftIntensity = Math.abs(lateralSpeed) * 0.6 + Math.max(0, planarSpeed - Math.abs(forwardSpeed));

        this.propHandle.setMotion({
            angularVelocity: {
                x: angularVelocity.x + (right.x * drive),
                y: angularVelocity.y,
                z: angularVelocity.z + (right.z * drive)
            },
            linearVelocity: { x: velocity.x, y: velocity.y, z: velocity.z },
            wakeUp: true
        });

        const now = nowMs();
        if ((now - this.lastVisualSyncAtMs) >= CAR_VISUAL_SYNC_INTERVAL_MS) {
            this.propHandle.syncNow(false);
            this.emitSyncEvent(CAR_EVENT_VISUAL_STATE, {
                facingYaw: this.facingYaw,
                steer: this.steerVisual,
                speed: this.speedVisual,
                acceleration: this.accelerationVisual,
                wheelSpin: this.wheelSpin,
                throttle: this.throttleVisual,
                driftIntensity: this.driftIntensity
            }, { localEcho: false });
            this.lastVisualSyncAtMs = now;
        }
    }

    private updateVisualRig(delta: number): void {
        const position = this.propHandle?.getPosition();
        const velocity = this.propHandle?.getLinearVelocity();
        if (position) {
            this.visualRig.position.set(position.x, position.y + CAR_VISUAL_HEIGHT_OFFSET + CAR_VISUAL_GROUND_BIAS, position.z);
        } else {
            this.visualRig.position.set(
                this.spawnPosition.x,
                this.spawnPosition.y + CAR_VISUAL_HEIGHT_OFFSET + CAR_VISUAL_GROUND_BIAS,
                this.spawnPosition.z
            );
        }

        this.presentFacingYaw = dampAngle(this.presentFacingYaw, this.facingYaw, CAR_FACING_YAW_DAMP, delta);
        this.presentSteerVisual = THREE.MathUtils.damp(this.presentSteerVisual, this.steerVisual, CAR_STEER_VISUAL_DAMP, delta);
        this.visualRig.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.presentFacingYaw);
        this.updateAudio(delta);

        const planarSpeed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;
        const wheelSpinDelta = planarSpeed > 0.001
            ? (planarSpeed / CAR_RADIUS) * delta
            : 0;
        const targetSpeedVisual = THREE.MathUtils.clamp(planarSpeed / CAR_SPEED_SCALE, -1, 1);
        this.speedVisual = THREE.MathUtils.damp(this.speedVisual, targetSpeedVisual, 8, delta);
        this.accelerationVisual = THREE.MathUtils.damp(this.accelerationVisual, targetSpeedVisual, 10, delta);
        if (wheelSpinDelta > 0) {
            this.wheelSpin += wheelSpinDelta;
        }

        if (this.bodyNode) {
            this.bodyNode.rotation.x = THREE.MathUtils.damp(
                this.bodyNode.rotation.x,
                -(this.speedVisual - this.accelerationVisual) / 6,
                10,
                delta
            );
            this.bodyNode.rotation.z = THREE.MathUtils.damp(
                this.bodyNode.rotation.z,
                -(this.presentSteerVisual / 5) * this.speedVisual,
                5,
                delta
            );
            this.bodyNode.position.y = THREE.MathUtils.damp(this.bodyNode.position.y, CAR_BODY_FLOAT_HEIGHT, 5, delta);
        }

        const steerAngle = this.presentSteerVisual / 1.5;
        if (this.wheelFL) this.wheelFL.rotation.y = THREE.MathUtils.damp(this.wheelFL.rotation.y, steerAngle, 10, delta);
        if (this.wheelFR) this.wheelFR.rotation.y = THREE.MathUtils.damp(this.wheelFR.rotation.y, steerAngle, 10, delta);

        for (const wheel of [this.wheelFL, this.wheelFR, this.wheelBL, this.wheelBR]) {
            if (!wheel) continue;
            wheel.rotation.x = this.wheelSpin;
        }
    }

    private applyVisualState(value: unknown): void {
        if (!value || typeof value !== 'object') return;
        const payload = value as Partial<ISimpleRacingCarVisualState>;
        if (typeof payload.facingYaw === 'number') this.facingYaw = payload.facingYaw;
        if (typeof payload.steer === 'number') this.steerVisual = payload.steer;
        if (typeof payload.speed === 'number') this.speedVisual = payload.speed;
        if (typeof payload.acceleration === 'number') this.accelerationVisual = payload.acceleration;
        if (typeof payload.wheelSpin === 'number') this.wheelSpin = payload.wheelSpin;
        if (typeof payload.throttle === 'number') this.throttleVisual = payload.throttle;
        if (typeof payload.driftIntensity === 'number') this.driftIntensity = payload.driftIntensity;
    }

    private updateAudio(delta: number): void {
        const audioPosition = this.getAudioPosition();
        this.engineEmitter?.setPosition(audioPosition);
        this.skidEmitter?.setPosition(audioPosition);

        const speedFactor = THREE.MathUtils.clamp(Math.abs(this.speedVisual), 0, 1);
        const throttleFactor = THREE.MathUtils.clamp(Math.abs(this.throttleVisual), 0, 1);
        const targetEngineVolume = remap(
            speedFactor + (throttleFactor * 0.5),
            0,
            1.5,
            CAR_ENGINE_BASE_VOLUME,
            CAR_ENGINE_MAX_VOLUME
        );
        this.engineVolume = THREE.MathUtils.lerp(this.engineVolume, targetEngineVolume, delta * CAR_ENGINE_LERP_RATE);
        this.engineEmitter?.setVolume(this.engineVolume);

        let targetEngineRate = remap(speedFactor, 0, 1, CAR_ENGINE_BASE_RATE, CAR_ENGINE_MAX_RATE);
        if (throttleFactor > 0.1) {
            targetEngineRate += 0.2;
        }
        this.engineRate = THREE.MathUtils.lerp(this.engineRate, targetEngineRate, delta * CAR_ENGINE_RATE_LERP);
        this.engineEmitter?.setPlaybackRate(this.engineRate);

        const clampedDrift = THREE.MathUtils.clamp(this.driftIntensity, CAR_SKID_MIN_DRIFT, CAR_SKID_MAX_DRIFT);
        const targetSkidVolume = this.driftIntensity > CAR_SKID_MIN_DRIFT
            ? remap(clampedDrift, CAR_SKID_MIN_DRIFT, CAR_SKID_MAX_DRIFT, CAR_SKID_MIN_VOLUME, CAR_SKID_MAX_VOLUME)
            : 0;
        this.skidVolume = THREE.MathUtils.lerp(this.skidVolume, targetSkidVolume, delta * CAR_SKID_VOLUME_LERP);
        this.skidEmitter?.setVolume(this.skidVolume);

        const targetSkidRate = THREE.MathUtils.clamp(Math.abs(this.speedVisual), CAR_SKID_MIN_RATE, CAR_SKID_MAX_RATE);
        this.skidRate = THREE.MathUtils.lerp(this.skidRate, targetSkidRate, 0.1);
        this.skidEmitter?.setPlaybackRate(this.skidRate);
    }

    private handleCollisionStarted(event: { entityAId: string | null; entityBId: string | null }): void {
        if (!this.propHandle) return;
        const entityId = this.propHandle.entityId;
        if (event.entityAId !== entityId && event.entityBId !== entityId) return;

        const velocity = this.propHandle.getLinearVelocity();
        if (!velocity) return;

        const impactSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
        if (impactSpeed < CAR_IMPACT_SPEED_THRESHOLD) return;

        const now = nowMs();
        if ((now - this.lastImpactSoundAtMs) < CAR_IMPACT_COOLDOWN_MS) return;
        this.lastImpactSoundAtMs = now;

        this.emitSyncEvent(CAR_EVENT_IMPACT, {
            position: this.getAudioPosition(),
            intensity: impactSpeed
        } satisfies ISimpleRacingCarImpactEvent);
    }

    private async playImpactFromEvent(value: unknown): Promise<void> {
        if (!value || typeof value !== 'object') return;
        const payload = value as Partial<ISimpleRacingCarImpactEvent>;
        const position = payload.position;
        if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
            return;
        }
        const intensity = typeof payload.intensity === 'number' ? payload.intensity : 0;

        const emitter = await this.runtimeContext.audio.createEmitter({
            url: SIMPLE_RACING_ASSETS.audio.impact,
            autoplay: true,
            position,
            volume: THREE.MathUtils.clamp(remap(intensity, 0, 6, 0.01, 1.0), 0.01, 1.0),
            playbackRate: 1,
            refDistance: 2.5,
            maxDistance: 36,
            rolloffFactor: 1.05
        });
        window.setTimeout(() => emitter.dispose(), 2000);
    }

    private getAudioPosition(): IVector3 {
        const position = this.propHandle?.getPosition();
        if (position) {
            return { x: position.x, y: position.y + 0.1, z: position.z };
        }
        return { x: this.spawnPosition.x, y: this.spawnPosition.y + 0.1, z: this.spawnPosition.z };
    }

    private releaseDrivingAuthorityIfLocal(): void {
        if (!this.propHandle || !this.propHandle.isAuthority()) return;
        const velocity = this.propHandle.getLinearVelocity();
        this.propHandle.releaseControl(velocity ?? undefined);
    }

    private createLocalMountBinding(): ILocalMountBinding {
        return {
            ownerInstanceId: this.id,
            mountPointId: 'driver',
            getSeatPose: () => this.getSeatPose(),
            getBodyYawPose: () => this.getBodyYawPose(),
            getViewPose: () => this.getViewPose(),
            getExitPose: () => this.getExitPose(),
            canUnmountNow: (reason) => reason !== 'movement'
        };
    }

    private getSeatPose(): { position: THREE.Vector3; yaw: number } {
        const base = this.getCarBasePosition();
        const offset = CAR_SEAT_OFFSET.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw);
        return {
            position: base.add(offset),
            yaw: this.facingYaw
        };
    }

    private getBodyYawPose(): { position: THREE.Vector3; yaw: number } {
        const base = this.getCarBasePosition();
        const offset = CAR_BODY_YAW_OFFSET.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw);
        return {
            position: base.add(offset),
            yaw: this.facingYaw
        };
    }

    private getViewPose(): { position: THREE.Vector3; yaw: number } {
        const base = this.getCarBasePosition();
        const offset = CAR_VIEW_OFFSET.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw);
        return {
            position: base.add(offset),
            yaw: this.facingYaw
        };
    }

    private getExitPose(): { position: THREE.Vector3; yaw: number } {
        const seatPose = this.getSeatPose();
        const offset = CAR_EXIT_OFFSET.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, seatPose.yaw);
        return {
            position: seatPose.position.clone().add(offset),
            yaw: seatPose.yaw
        };
    }

    private getCarBasePosition(): THREE.Vector3 {
        const position = this.propHandle?.getPosition();
        return position
            ? new THREE.Vector3(position.x, position.y, position.z)
            : this.spawnPosition.clone();
    }

    private resetCar(): void {
        if (!this.propHandle) return;
        if (!this.propHandle.requestControl()) return;

        this.facingYaw = this.spawnYaw;
        this.presentFacingYaw = this.spawnYaw;
        this.linearSpeed = 0;
        this.angularSpeed = 0;
        this.accelerationVisual = 0;
        this.steerVisual = 0;
        this.presentSteerVisual = 0;
        this.speedVisual = 0;
        this.wheelSpin = 0;
        this.throttleVisual = 0;
        this.driftIntensity = 0;
        this.engineVolume = 0;
        this.engineRate = 1;
        this.skidVolume = 0;
        this.skidRate = 1;
        this.propHandle.setPose({
            position: { x: this.spawnPosition.x, y: this.spawnPosition.y, z: this.spawnPosition.z },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            linearVelocity: { x: 0, y: 0, z: 0 },
            angularVelocity: { x: 0, y: 0, z: 0 },
            wakeUp: true,
            forceSync: true
        });
        this.emitSyncEvent(CAR_EVENT_VISUAL_STATE, {
            facingYaw: this.facingYaw,
            steer: this.steerVisual,
            speed: this.speedVisual,
            acceleration: this.accelerationVisual,
            wheelSpin: this.wheelSpin,
            throttle: this.throttleVisual,
            driftIntensity: this.driftIntensity
        }, { localEcho: false });
    }
}

export class SimpleRacingCarObject implements IObjectModule {
    public readonly id = 'simple-racing-car';
    public readonly displayName = 'Simple Racing Car';
    public readonly tags = ['racing', 'vehicle', 'shared', 'mountable'];
    public readonly networked = true;
    public readonly portable = false;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): SimpleRacingCarInstance {
        return new SimpleRacingCarInstance(context, config);
    }
}


function nowMs(): number {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
}

function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
    return outMin + ((outMax - outMin) * ((value - inMin) / (inMax - inMin)));
}

function dampAngle(current: number, target: number, lambda: number, delta: number): number {
    const deltaAngle = THREE.MathUtils.euclideanModulo((target - current) + Math.PI, Math.PI * 2) - Math.PI;
    return current + (deltaAngle * (1 - Math.exp(-lambda * delta)));
}
