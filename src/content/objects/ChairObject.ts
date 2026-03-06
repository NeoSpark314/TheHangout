import * as THREE from 'three';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta, IObjectReplicationPolicy } from '../contracts/IReplicatedObjectInstance';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IHoldable } from '../../shared/contracts/IHoldable';
import type { IInteractable } from '../../shared/contracts/IInteractable';
import type { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { IMountableObject } from '../contracts/IMountableObject';

interface IChairOccupancyPayload {
    occupiedBy: string | null;
}

interface IChairMountRequestPayload {
    mountPointId?: string;
}

interface IChairMountReleaseRequestPayload {
    mountPointId?: string;
    reason?: string;
}

interface IChairMountRejectedPayload {
    playerId: string;
    reason: string;
}

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

class ChairInstance extends BaseReplicatedObjectInstance implements IMountableObject {
    private static readonly MOUNT_POINT_ID = 'seat-0';

    public readonly replicationPolicy: IObjectReplicationPolicy = {
        relayIncomingFromPeer: 'others',
        includeInSnapshot: true,
        defaultLocalEcho: true
    };

    private readonly seatPosition: THREE.Vector3;
    private readonly seatYaw: number;
    private readonly seatEntity: ChairSeatEntity;
    private occupiedBy: string | null = null;
    private hovered = false;
    private awaitingMountAuthority = false;
    private awaitingReleaseAuthority = false;

    constructor(context: IObjectSpawnContext, config: IObjectSpawnConfig) {
        super(context, 'chair');
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
        this.createPhysicsColliders();
    }

    public getPrimaryEntity(): IEntity {
        return this.seatEntity;
    }

    public update(): void {
        const localPlayerId = this.context.app.localPlayer?.id ?? null;

        if (this.occupiedBy === localPlayerId && !this.context.mount.isMountedLocal(this.id)) {
            this.requestAuthoritativeRelease('movement');
            return;
        }

        if (this.occupiedBy && this.context.mount.isMountedLocal(this.id) && this.occupiedBy !== localPlayerId) {
            this.context.mount.unmountLocal(this.id, 'external');
        }
    }

    public canMount(playerId: string): boolean {
        return !this.occupiedBy || this.occupiedBy === playerId;
    }

    public mount(playerId: string): boolean {
        if (this.context.app.isHost) {
            return this.applyAuthoritativeMount(playerId);
        }
        if (!this.canMount(playerId)) return false;

        this.awaitingMountAuthority = true;
        if (playerId === this.context.app.localPlayer?.id) {
            this.context.mount.requestLocalMount(this.createLocalMountBinding());
        }
        this.emitSyncEvent('mount-request', { mountPointId: ChairInstance.MOUNT_POINT_ID }, { localEcho: false });
        return true;
    }

    public unmount(playerId: string): void {
        if (this.context.app.isHost) {
            this.applyAuthoritativeRelease(playerId, 'released');
            return;
        }

        if (this.occupiedBy !== playerId) return;
        this.awaitingReleaseAuthority = true;
        if (playerId === this.context.app.localPlayer?.id) {
            this.context.mount.releaseLocalMount(this.id, 'released');
        }
        this.emitSyncEvent('mount-release-request', {
            mountPointId: ChairInstance.MOUNT_POINT_ID,
            reason: 'released'
        }, { localEcho: false });
    }

    public isOccupied(): boolean {
        return !!this.occupiedBy;
    }

    public handleInteraction(event: IInteractionEvent): void {
        if (event.type !== 'trigger' || event.phase !== 'start') return;

        if (this.occupiedBy === event.playerId) {
            this.unmount(event.playerId);
            return;
        }

        if (!this.occupiedBy) {
            this.mount(event.playerId);
        }
    }

    public setHovered(hovered: boolean): void {
        this.hovered = hovered;
        this.applySeatVisualState();
    }

    public onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void {
        if (eventType === 'occupancy') {
            this.applyOccupancyPayload(data);
            return;
        }

        if (eventType === 'mount-request') {
            if (!this.context.app.isHost) return;
            this.handleMountRequestAsHost(meta.senderId, data);
            return;
        }

        if (eventType === 'mount-release-request') {
            if (!this.context.app.isHost) return;
            this.handleMountReleaseRequestAsHost(meta.senderId, data);
            return;
        }

        if (eventType === 'mount-rejected') {
            this.handleMountRejected(data);
        }
    }

    public captureReplicationSnapshot(): unknown {
        return {
            occupiedBy: this.occupiedBy
        };
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        if (!snapshot || typeof snapshot !== 'object') return;
        const payload = snapshot as IChairOccupancyPayload;
        if (payload.occupiedBy !== null && typeof payload.occupiedBy !== 'string') return;
        this.applyOccupancyPayload(payload);
    }

    private createLocalMountBinding(): {
        ownerInstanceId: string;
        mountPointId: string;
        getSeatPose: () => { position: THREE.Vector3; yaw: number };
        getExitPose: () => { position: THREE.Vector3; yaw: number };
    } {
        return {
            ownerInstanceId: this.id,
            mountPointId: ChairInstance.MOUNT_POINT_ID,
            getSeatPose: () => this.getSeatPose(),
            getExitPose: () => this.getExitPose()
        };
    }

    private applyAuthoritativeMount(playerId: string): boolean {
        if (!this.canMount(playerId)) return false;
        this.occupiedBy = playerId;
        this.awaitingMountAuthority = false;
        this.awaitingReleaseAuthority = false;
        if (playerId === this.context.app.localPlayer?.id && !this.context.mount.isMountedLocal(this.id)) {
            this.context.mount.grantLocalMount(this.createLocalMountBinding());
        }
        this.emitSyncEvent('occupancy', { occupiedBy: playerId }, { localEcho: false });
        this.applySeatVisualState();
        return true;
    }

    private applyAuthoritativeRelease(playerId: string, reason: 'released' | 'movement' | 'external'): boolean {
        if (this.occupiedBy !== playerId) return false;
        this.occupiedBy = null;
        this.awaitingMountAuthority = false;
        this.awaitingReleaseAuthority = false;

        if (playerId === this.context.app.localPlayer?.id) {
            this.context.mount.unmountLocal(this.id, reason);
        }

        this.emitSyncEvent('occupancy', { occupiedBy: null }, { localEcho: false });
        this.applySeatVisualState();
        return true;
    }

    private requestAuthoritativeRelease(reason: 'released' | 'movement' | 'external'): void {
        const localPlayerId = this.context.app.localPlayer?.id;
        if (!localPlayerId || this.occupiedBy !== localPlayerId) return;

        if (this.context.app.isHost) {
            this.applyAuthoritativeRelease(localPlayerId, reason);
            return;
        }

        if (this.awaitingReleaseAuthority) return;
        this.awaitingReleaseAuthority = true;
        this.emitSyncEvent('mount-release-request', {
            mountPointId: ChairInstance.MOUNT_POINT_ID,
            reason
        }, { localEcho: false });
    }

    private handleMountRequestAsHost(senderId: string | null, data: unknown): void {
        if (!senderId) return;
        const payload = data as IChairMountRequestPayload;
        const mountPointId = payload?.mountPointId ?? ChairInstance.MOUNT_POINT_ID;
        if (mountPointId !== ChairInstance.MOUNT_POINT_ID) {
            this.emitMountRejected(senderId, 'invalid_mount_point');
            return;
        }
        if (!this.applyAuthoritativeMount(senderId)) {
            this.emitMountRejected(senderId, 'occupied');
        }
    }

    private handleMountReleaseRequestAsHost(senderId: string | null, data: unknown): void {
        if (!senderId) return;
        const payload = data as IChairMountReleaseRequestPayload;
        const mountPointId = payload?.mountPointId ?? ChairInstance.MOUNT_POINT_ID;
        if (mountPointId !== ChairInstance.MOUNT_POINT_ID) {
            this.emitMountRejected(senderId, 'invalid_mount_point');
            return;
        }
        const reason = payload?.reason === 'movement' ? 'movement' : 'released';
        if (!this.applyAuthoritativeRelease(senderId, reason)) {
            this.emitMountRejected(senderId, 'not_occupant');
        }
    }

    private emitMountRejected(playerId: string, reason: string): void {
        this.emitSyncEvent('mount-rejected', { playerId, reason }, { localEcho: false });
    }

    private handleMountRejected(data: unknown): void {
        const payload = data as IChairMountRejectedPayload;
        if (!payload || typeof payload.playerId !== 'string' || typeof payload.reason !== 'string') return;
        const localPlayerId = this.context.app.localPlayer?.id;
        if (!localPlayerId || payload.playerId !== localPlayerId) return;
        this.awaitingMountAuthority = false;
        this.awaitingReleaseAuthority = false;
        this.context.mount.rejectLocalMount();
    }

    private applyOccupancyPayload(data: unknown): void {
        const payload = data as IChairOccupancyPayload;
        if (!payload || (payload.occupiedBy !== null && typeof payload.occupiedBy !== 'string')) return;
        this.occupiedBy = payload.occupiedBy;

        const localPlayerId = this.context.app.localPlayer?.id ?? null;
        if (this.occupiedBy === localPlayerId) {
            this.awaitingMountAuthority = false;
            this.awaitingReleaseAuthority = false;
            if (!this.context.mount.isMountedLocal(this.id)) {
                this.context.mount.grantLocalMount(this.createLocalMountBinding());
            }
        } else if (this.context.mount.isMountedLocal(this.id)) {
            this.context.mount.unmountLocal(this.id, 'external');
            if (this.awaitingMountAuthority && this.occupiedBy !== localPlayerId) {
                this.context.mount.rejectLocalMount();
            }
            this.awaitingMountAuthority = false;
            if (!this.occupiedBy) {
                this.awaitingReleaseAuthority = false;
            }
        } else {
            if (this.awaitingMountAuthority && this.occupiedBy !== localPlayerId) {
                this.context.mount.rejectLocalMount();
                this.awaitingMountAuthority = false;
            }
            if (!this.occupiedBy) {
                this.awaitingReleaseAuthority = false;
            }
        }

        this.applySeatVisualState();
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

    private applySeatVisualState(): void {
        const seatMesh = this.seatEntity.mesh.children[0] as THREE.Mesh | undefined;
        const backMesh = this.seatEntity.mesh.children[1] as THREE.Mesh | undefined;
        const seatMat = seatMesh?.material as THREE.MeshStandardMaterial | undefined;
        const backMat = backMesh?.material as THREE.MeshStandardMaterial | undefined;
        const occupied = !!this.occupiedBy;
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

    private createPhysicsColliders(): void {
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.seatYaw);
        const rotationPose = {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z,
            w: rotation.w
        };

        const colliderSpecs = [
            { half: new THREE.Vector3(0.23, 0.04, 0.23), local: new THREE.Vector3(0, 0.46, 0) },
            { half: new THREE.Vector3(0.23, 0.28, 0.04), local: new THREE.Vector3(0, 0.78, -0.19) },
            { half: new THREE.Vector3(0.025, 0.22, 0.025), local: new THREE.Vector3(-0.18, 0.22, -0.18) },
            { half: new THREE.Vector3(0.025, 0.22, 0.025), local: new THREE.Vector3(0.18, 0.22, -0.18) },
            { half: new THREE.Vector3(0.025, 0.22, 0.025), local: new THREE.Vector3(-0.18, 0.22, 0.18) },
            { half: new THREE.Vector3(0.025, 0.22, 0.025), local: new THREE.Vector3(0.18, 0.22, 0.18) }
        ];

        for (const spec of colliderSpecs) {
            const worldOffset = spec.local.clone().applyQuaternion(rotation);
            const worldPosition = this.seatPosition.clone().add(worldOffset);
            const collider = this.context.physics.createStaticCuboidCollider(
                spec.half.x,
                spec.half.y,
                spec.half.z,
                { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
                rotationPose
            );
            if (!collider) continue;

            this.context.physics.registerInteractionCollider(collider, this.seatEntity);
            this.addCleanup(() => {
                this.context.physics.unregisterInteractionCollider(collider);
            });

            const body = collider.body;
            if (body) {
                this.ownPhysicsBody(body);
            }
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
