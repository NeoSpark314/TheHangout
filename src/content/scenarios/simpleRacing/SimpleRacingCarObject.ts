import * as THREE from 'three';
import type { IEntity } from '../../../shared/contracts/IEntity';
import type { IHoldable } from '../../../shared/contracts/IHoldable';
import type { IInteractable } from '../../../shared/contracts/IInteractable';
import type { IInteractionEvent } from '../../../shared/contracts/IInteractionEvent';
import type { IVector3 } from '../../../shared/contracts/IMath';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../../contracts/IObjectModule';
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

const CAR_MOUNT_EVENTS: IAuthoritativeSingleMountEventMap = {
    occupancy: CAR_EVENT_OCCUPANCY,
    mountRequest: CAR_EVENT_MOUNT_REQUEST,
    mountReleaseRequest: CAR_EVENT_MOUNT_RELEASE_REQUEST,
    mountRejected: CAR_EVENT_MOUNT_REJECTED
};

const CAR_RADIUS = 0.52;
const CAR_SEAT_OFFSET = new THREE.Vector3(0, 0.65, 0.05);
const CAR_EXIT_OFFSET = new THREE.Vector3(1.35, 0.15, 0);
const CAR_VISUAL_HEIGHT_OFFSET = -0.5;
const CAR_MOUNT_ZONE_OFFSET = new THREE.Vector3(0, 0.45, 0.02);
const CAR_MOUNT_ZONE_SIZE = new THREE.Vector3(1.45, 0.95, 2.35);
const CAR_RESET_FALL_Y = -6;
const CAR_MAX_DRIVE_DISTANCE = 140;
const CAR_ACCELERATION = 22;
const CAR_BRAKE_DECEL = 30;
const CAR_REVERSE_ACCELERATION = 10;
const CAR_FORWARD_SPEED = 13.5;
const CAR_REVERSE_SPEED = 4.5;
const CAR_LATERAL_DAMPING = 7.5;
const CAR_TURN_RATE = 3.6;
const CAR_STEER_RESPONSE = 8.5;
const CAR_IDLE_DAMPING = 4.2;
const CAR_VISUAL_SYNC_INTERVAL_MS = 90;
const CAR_WHEEL_SPIN_FACTOR = 5.5;

interface ISimpleRacingCarSnapshot {
    occupiedBy: string | null;
    facingYaw: number;
    steer: number;
    speed: number;
    wheelSpin: number;
}

interface ISimpleRacingCarVisualState {
    facingYaw: number;
    steer: number;
    speed: number;
    wheelSpin: number;
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
    private steerVisual = 0;
    private speedVisual = 0;
    private wheelSpin = 0;
    private bodyNode: THREE.Object3D | null = null;
    private wheelFL: THREE.Object3D | null = null;
    private wheelFR: THREE.Object3D | null = null;
    private wheelBL: THREE.Object3D | null = null;
    private wheelBR: THREE.Object3D | null = null;
    private lastVisualSyncAtMs = 0;

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
            replicationProfileId: 'default-prop'
        });

        this.runtimeContext = context as ObjectRuntimeContext;
        this.root = root;
        this.spawnPosition = new THREE.Vector3(position.x, position.y, position.z);
        this.spawnYaw = spawnYaw;
        this.facingYaw = spawnYaw;

        this.visualRig.position.set(0, CAR_VISUAL_HEIGHT_OFFSET, 0);
        this.root.add(this.visualRig);

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

        void this.loadVisuals();
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
        }
    }

    public override captureReplicationSnapshot(): unknown {
        return {
            occupiedBy: this.mountReplication.getOccupiedBy(),
            facingYaw: this.facingYaw,
            steer: this.steerVisual,
            speed: this.speedVisual,
            wheelSpin: this.wheelSpin
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
        const input = this.runtimeContext.input.getMovementVector();
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw);
        const planarVelocity = new THREE.Vector3(velocity.x, 0, velocity.z);

        const forwardSpeed = planarVelocity.dot(forward);
        const lateralSpeed = planarVelocity.dot(right);
        const desiredSpeed = input.y >= 0 ? input.y * CAR_FORWARD_SPEED : input.y * CAR_REVERSE_SPEED;

        let nextForwardSpeed = forwardSpeed;
        if (input.y > 0.01) {
            nextForwardSpeed = moveTowards(forwardSpeed, desiredSpeed, CAR_ACCELERATION * delta);
        } else if (input.y < -0.01) {
            if (forwardSpeed > 0.1) {
                nextForwardSpeed = moveTowards(forwardSpeed, 0, CAR_BRAKE_DECEL * delta);
            } else {
                nextForwardSpeed = moveTowards(forwardSpeed, desiredSpeed, CAR_REVERSE_ACCELERATION * delta);
            }
        } else {
            nextForwardSpeed = moveTowards(forwardSpeed, 0, CAR_IDLE_DAMPING * delta);
        }

        const nextLateralSpeed = moveTowards(lateralSpeed, 0, CAR_LATERAL_DAMPING * delta * Math.max(1, Math.abs(forwardSpeed)));
        const speedRatio = THREE.MathUtils.clamp(Math.abs(nextForwardSpeed) / CAR_FORWARD_SPEED, 0.2, 1.0);
        const direction = nextForwardSpeed >= 0 ? 1 : -1;
        const targetSteer = input.x;
        this.steerVisual = THREE.MathUtils.damp(this.steerVisual, targetSteer, CAR_STEER_RESPONSE, delta);
        this.facingYaw += (-this.steerVisual * CAR_TURN_RATE * speedRatio * direction) * delta;

        const nextVelocity = forward.multiplyScalar(nextForwardSpeed).add(right.multiplyScalar(nextLateralSpeed));
        this.speedVisual = nextForwardSpeed;
        this.wheelSpin += nextForwardSpeed * CAR_WHEEL_SPIN_FACTOR * delta;

        this.propHandle.setMotion({
            linearVelocity: { x: nextVelocity.x, y: velocity.y, z: nextVelocity.z },
            wakeUp: true
        });

        const now = nowMs();
        if ((now - this.lastVisualSyncAtMs) >= CAR_VISUAL_SYNC_INTERVAL_MS) {
            this.propHandle.syncNow(false);
            this.emitSyncEvent(CAR_EVENT_VISUAL_STATE, {
                facingYaw: this.facingYaw,
                steer: this.steerVisual,
                speed: this.speedVisual,
                wheelSpin: this.wheelSpin
            }, { localEcho: false });
            this.lastVisualSyncAtMs = now;
        }
    }

    private updateVisualRig(delta: number): void {
        const sphereRotation = this.root.quaternion;
        const desiredFacing = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw);
        const inverseSphere = sphereRotation.clone().invert();
        this.visualRig.quaternion.copy(inverseSphere.multiply(desiredFacing));

        if (this.bodyNode) {
            this.bodyNode.rotation.x = THREE.MathUtils.damp(
                this.bodyNode.rotation.x,
                -(this.speedVisual / CAR_FORWARD_SPEED) * 0.12,
                8,
                delta
            );
            this.bodyNode.rotation.z = THREE.MathUtils.damp(
                this.bodyNode.rotation.z,
                -(this.steerVisual * this.speedVisual / CAR_FORWARD_SPEED) * 0.28,
                7,
                delta
            );
            this.bodyNode.position.y = THREE.MathUtils.damp(this.bodyNode.position.y, 0.08, 7, delta);
        }

        const steerAngle = -this.steerVisual * 0.5;
        if (this.wheelFL) this.wheelFL.rotation.y = THREE.MathUtils.damp(this.wheelFL.rotation.y, steerAngle, 10, delta);
        if (this.wheelFR) this.wheelFR.rotation.y = THREE.MathUtils.damp(this.wheelFR.rotation.y, steerAngle, 10, delta);

        for (const wheel of [this.wheelFL, this.wheelFR, this.wheelBL, this.wheelBR]) {
            if (!wheel) continue;
            wheel.rotation.x += this.speedVisual * CAR_WHEEL_SPIN_FACTOR * delta;
        }
    }

    private applyVisualState(value: unknown): void {
        if (!value || typeof value !== 'object') return;
        const payload = value as Partial<ISimpleRacingCarVisualState>;
        if (typeof payload.facingYaw === 'number') this.facingYaw = payload.facingYaw;
        if (typeof payload.steer === 'number') this.steerVisual = payload.steer;
        if (typeof payload.speed === 'number') this.speedVisual = payload.speed;
        if (typeof payload.wheelSpin === 'number') this.wheelSpin = payload.wheelSpin;
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
            getExitPose: () => this.getExitPose(),
            canUnmountNow: (reason) => reason !== 'movement'
        };
    }

    private getSeatPose(): { position: THREE.Vector3; yaw: number } {
        const position = this.propHandle?.getPosition();
        const base = position
            ? new THREE.Vector3(position.x, position.y, position.z)
            : this.spawnPosition.clone();
        const offset = CAR_SEAT_OFFSET.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.facingYaw);
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

    private resetCar(): void {
        if (!this.propHandle) return;
        if (!this.propHandle.requestControl()) return;

        this.facingYaw = this.spawnYaw;
        this.steerVisual = 0;
        this.speedVisual = 0;
        this.wheelSpin = 0;
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
            wheelSpin: this.wheelSpin
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

function moveTowards(current: number, target: number, maxDelta: number): number {
    if (Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
}

function nowMs(): number {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
}
