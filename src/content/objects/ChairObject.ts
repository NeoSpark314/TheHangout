import * as THREE from 'three';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IHoldable } from '../../shared/contracts/IHoldable';
import type { IInteractable } from '../../shared/contracts/IInteractable';
import type { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { IPhysicsColliderHandle } from '../contracts/IObjectRuntimeContext';

import type { ILocalMountBinding } from '../contracts/IMounting';
import {
    AuthoritativeSingleMountReplicator,
    type IAuthoritativeSingleMountEventMap
} from '../runtime/AuthoritativeSingleMountReplicator';
import { ObjectRuntimeContext } from '../runtime/ObjectRuntimeContext';

const CHAIR_EVENT_OCCUPANCY = 'occupancy';
const CHAIR_EVENT_MOUNT_REQUEST = 'mount-request';
const CHAIR_EVENT_MOUNT_RELEASE_REQUEST = 'mount-release-request';
const CHAIR_EVENT_MOUNT_REJECTED = 'mount-rejected';

const CHAIR_MOUNT_EVENTS: IAuthoritativeSingleMountEventMap = {
    occupancy: CHAIR_EVENT_OCCUPANCY,
    mountRequest: CHAIR_EVENT_MOUNT_REQUEST,
    mountReleaseRequest: CHAIR_EVENT_MOUNT_RELEASE_REQUEST,
    mountRejected: CHAIR_EVENT_MOUNT_REJECTED
};

class ChairSeatEntity implements IEntity, IHoldable, IInteractable {
    public readonly type = 'CONTENT_CHAIR';
    public readonly isHoldable = true;
    public heldBy: string | null = null;
    public isAuthority = true;
    public isDestroyed = false;
    public readonly mesh: THREE.Group;

    constructor(
        public id: string,
        private owner: ChairInstance,
        position: THREE.Vector3,
        yaw: number
    ) {
        this.mesh = new THREE.Group();
        this.mesh.name = `chair:${id}`;
        this.mesh.position.copy(position);
        this.mesh.rotation.y = yaw;
        this.mesh.userData.entityId = id;

        const seatMat = new THREE.MeshStandardMaterial({
            color: 0x2b1b12,
            roughness: 0.85,
            metalness: 0.1
        });
        const accentMat = new THREE.MeshStandardMaterial({
            color: 0x00c8ff,
            emissive: 0x004466,
            emissiveIntensity: 0.12,
            roughness: 0.5,
            metalness: 0.4
        });

        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.46), seatMat);
        seat.position.set(0, 0.46, 0);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.08), seatMat);
        back.position.set(0, 0.78, -0.19);
        const legGeo = new THREE.BoxGeometry(0.05, 0.44, 0.05);
        const legOffsets: Array<[number, number]> = [
            [-0.18, -0.18],
            [0.18, -0.18],
            [-0.18, 0.18],
            [0.18, 0.18]
        ];
        for (const [x, z] of legOffsets) {
            const leg = new THREE.Mesh(legGeo, accentMat);
            leg.position.set(x, 0.22, z);
            this.mesh.add(leg);
        }

        this.mesh.add(seat, back);
        this.mesh.traverse((child) => {
            child.userData.entityId = id;
        });
        this.mesh.userData.seatHeight = 0.5;
    }

    public update(): void { }

    public destroy(): void {
        if (this.isDestroyed) return;
        this.isDestroyed = true;
    }

    public onGrab(playerId: string, _hand: 'left' | 'right'): void {
        this.heldBy = playerId;
        // Chairs are fixed hold targets. Grab establishes interaction ownership without moving the chair.
    }

    public onRelease(_velocity?: IVector3): void {
        this.heldBy = null;
        // Chairs remain fixed when released.
    }

    public onHoverEnter(): void {
        this.owner.setHovered(true);
    }

    public onHoverExit(): void {
        this.owner.setHovered(false);
    }

    public onInteraction(event: IInteractionEvent): void {
        this.owner.handleInteraction(event);
    }

    public getGrabRadius(): number {
        return 0.45;
    }

    public getHoldReleaseDistance(): number {
        return 0.28;
    }
}

class ChairInstance extends BaseReplicatedObjectInstance {
    private static readonly MOUNT_POINT_ID = 'seat-0';

    private readonly seatPosition: THREE.Vector3;
    private readonly seatYaw: number;
    private readonly seatEntity: ChairSeatEntity;
    private readonly interactionColliders: IPhysicsColliderHandle[] = [];
    private readonly mountReplication: AuthoritativeSingleMountReplicator;
    private readonly runtimeContext: ObjectRuntimeContext;
    private hovered = false;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        super(context, 'chair');
        this.runtimeContext = context as ObjectRuntimeContext;
        this.seatPosition = config.position
            ? new THREE.Vector3(config.position.x, config.position.y, config.position.z)
            : new THREE.Vector3(0, 0, 0);
        this.seatYaw = typeof config.rotationY === 'number' ? config.rotationY : 0;
        this.seatEntity = new ChairSeatEntity(this.id, this, this.seatPosition, this.seatYaw);
        this.addCleanup(() => {
            this.seatEntity.mesh.traverse((node) => {
                const mesh = node as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) mesh.material.forEach((mat) => mat.dispose());
                    else mesh.material.dispose();
                }
            });
        });
        this.ownSceneObject(this.seatEntity.mesh);
        this.createInteractionCollider(
            { x: 0.28, y: 0.12, z: 0.28 },
            new THREE.Vector3(0, 0.5, 0)
        );
        this.createInteractionCollider(
            { x: 0.28, y: 0.28, z: 0.08 },
            new THREE.Vector3(0, 0.78, -0.19)
        );
        this.addCleanup(() => {
            for (const collider of this.interactionColliders) {
                this.runtimeContext.removeInteractionCollider(collider);
            }
        });
        this.mountReplication = new AuthoritativeSingleMountReplicator(
            {
                context: this.runtimeContext,
                ownerInstanceId: this.id,
                mountPointId: ChairInstance.MOUNT_POINT_ID,
                mountLabel: 'chair',
                createLocalMountBinding: () => this.createLocalMountBinding(),
                canMount: (playerId, occupiedBy) => !occupiedBy || occupiedBy === playerId,
                onOccupancyChanged: () => this.applySeatVisualState()
            },
            (eventType, data, options) => this.emitSyncEvent(eventType, data as Record<string, any>, options),
            CHAIR_MOUNT_EVENTS
        );
    }

    public getPrimaryEntity(): IEntity {
        return this.seatEntity;
    }

    public update(): void {
        const localPlayerId = this.context.players.getLocal()?.id ?? null;

        if (this.mountReplication.getOccupiedBy() === localPlayerId && !this.runtimeContext.isMountedLocal(this.id)) {
            const mountStatus = this.runtimeContext.getLocalMountStatus();
            if (mountStatus.state === 'idle' && mountStatus.reason === 'movement') {
                this.mountReplication.requestAuthoritativeReleaseForLocal('movement');
            }
            return;
        }

        if (this.mountReplication.getOccupiedBy() && this.runtimeContext.isMountedLocal(this.id) && this.mountReplication.getOccupiedBy() !== localPlayerId) {
            this.runtimeContext.unmountLocal(this.id, 'external');
        }
    }

    private canMount(playerId: string): boolean {
        return this.mountReplication.canMount(playerId);
    }

    private mount(playerId: string): boolean {
        return this.mountReplication.mount(playerId);
    }

    private unmount(playerId: string): void {
        this.mountReplication.unmount(playerId, 'released');
    }

    private isOccupied(): boolean {
        return this.mountReplication.isOccupied();
    }

    public handleInteraction(event: IInteractionEvent): void {
        if (event.type !== 'trigger' || event.phase !== 'start') return;

        if (this.mountReplication.getOccupiedBy() === event.playerId) {
            this.unmount(event.playerId);
            return;
        }

        this.mount(event.playerId);
    }

    public setHovered(hovered: boolean): void {
        this.hovered = hovered;
        this.applySeatVisualState();
    }

    public onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void {
        this.mountReplication.handleReplicationEvent(eventType, data, meta);
    }

    public captureReplicationSnapshot(): unknown {
        return this.mountReplication.captureSnapshot();
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        this.mountReplication.applySnapshot(snapshot);
    }

    private createLocalMountBinding(): ILocalMountBinding {
        return {
            ownerInstanceId: this.id,
            mountPointId: ChairInstance.MOUNT_POINT_ID,
            getSeatPose: () => this.getSeatPose(),
            getExitPose: () => this.getExitPose(),
            canUnmountNow: (_reason) => true
        };
    }

    private getSeatPose(): { position: THREE.Vector3; yaw: number } {
        return {
            position: new THREE.Vector3(this.seatPosition.x, this.seatPosition.y + 0.2, this.seatPosition.z + 0.02),
            yaw: this.seatYaw + Math.PI
        };
    }

    private getExitPose(): { position: THREE.Vector3; yaw: number } {
        const forward = new THREE.Vector3(0, 0, 0.75).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatYaw);
        return {
            position: this.getSeatPose().position.clone().add(forward),
            yaw: this.seatYaw + Math.PI
        };
    }

    private createInteractionCollider(
        halfExtents: { x: number; y: number; z: number },
        localOffset: THREE.Vector3
    ): void {
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.seatYaw);
        const worldOffset = localOffset.clone().applyQuaternion(rotation);
        const collider = this.runtimeContext.createInteractionBox(
            halfExtents,
            {
                x: this.seatPosition.x + worldOffset.x,
                y: this.seatPosition.y + worldOffset.y,
                z: this.seatPosition.z + worldOffset.z
            },
            this.seatEntity,
            rotation
        );
        if (!collider) return;
        this.interactionColliders.push(collider);
        if (collider.body) {
            this.ownPhysicsBody(collider.body);
        }
    }

    private applySeatVisualState(): void {
        const seatMesh = this.seatEntity.mesh.children[0] as THREE.Mesh | undefined;
        const backMesh = this.seatEntity.mesh.children[1] as THREE.Mesh | undefined;
        const seatMat = seatMesh?.material as THREE.MeshStandardMaterial | undefined;
        const backMat = backMesh?.material as THREE.MeshStandardMaterial | undefined;
        const occupied = !!this.mountReplication.getOccupiedBy();
        const emissiveIntensity = occupied ? 0.18 : (this.hovered ? 0.1 : 0.03);
        const emissiveColor = occupied ? 0x00ff99 : 0x003344;

        if (seatMat) {
            seatMat.emissive.setHex(emissiveColor);
            seatMat.emissiveIntensity = emissiveIntensity;
        }
        if (backMat) {
            backMat.emissive.setHex(emissiveColor);
            backMat.emissiveIntensity = emissiveIntensity;
        }
    }
}

export class ChairObject implements IObjectModule {
    public readonly id = 'chair';
    public readonly displayName = 'Chair';
    public readonly tags = ['furniture', 'mountable', 'shared'];
    public readonly networked = true;
    public readonly portable = false;

    public spawn(context: IObjectSpawnContext, config: IObjectSpawnConfig): ChairInstance {
        return new ChairInstance(context, config);
    }
}
