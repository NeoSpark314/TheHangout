import * as THREE from 'three';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';
import type { IObjectModule, IObjectSpawnConfig, IObjectSpawnContext } from '../contracts/IObjectModule';
import type { IObjectReplicationMeta } from '../contracts/IReplicatedObjectInstance';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IHoldable } from '../../shared/contracts/IHoldable';
import type { IInteractable } from '../../shared/contracts/IInteractable';
import type { IInteractionEvent } from '../../shared/contracts/IInteractionEvent';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { IMountableObject } from '../contracts/IMountableObject';

interface IChairOccupancyPayload {
    occupiedBy: string | null;
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

        const hotspot = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.22, 0.4, 16),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
        );
        hotspot.position.set(0, 0.65, 0.04);
        hotspot.userData.entityId = id;

        this.mesh.add(seat, back, hotspot);
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
}

class ChairInstance extends BaseReplicatedObjectInstance implements IMountableObject {
    private readonly seatPosition: THREE.Vector3;
    private readonly seatYaw: number;
    private readonly seatEntity: ChairSeatEntity;
    private occupiedBy: string | null = null;
    private hovered = false;

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
        const interactionGroup = this.context.app.runtime.render?.interactionGroup;
        if (interactionGroup) {
            interactionGroup.add(this.seatEntity.mesh);
            this.addCleanup(() => {
                interactionGroup.remove(this.seatEntity.mesh);
            });
        }
    }

    public getPrimaryEntity(): IEntity {
        return this.seatEntity;
    }

    public update(): void {
        const localPlayerId = this.context.app.localPlayer?.id ?? null;

        if (this.occupiedBy === localPlayerId && !this.context.mount.isMountedLocal(this.id)) {
            this.occupiedBy = null;
            this.emitSyncEvent('occupancy', { occupiedBy: null });
            this.applySeatVisualState();
            return;
        }

        if (this.occupiedBy && this.context.mount.isMountedLocal(this.id) && this.occupiedBy !== localPlayerId) {
            this.context.mount.unmountLocal(this.id);
        }
    }

    public canMount(playerId: string): boolean {
        return !this.occupiedBy || this.occupiedBy === playerId;
    }

    public mount(playerId: string): boolean {
        if (!this.canMount(playerId)) return false;
        this.occupiedBy = playerId;
        this.emitSyncEvent('occupancy', { occupiedBy: playerId });

        if (playerId === this.context.app.localPlayer?.id) {
            this.context.mount.mountLocal({
                ownerInstanceId: this.id,
                getSeatPose: () => this.getSeatPose(),
                getExitPose: () => this.getExitPose()
            });
        }

        this.applySeatVisualState();
        return true;
    }

    public unmount(playerId: string): void {
        if (this.occupiedBy !== playerId) return;
        this.occupiedBy = null;
        if (playerId === this.context.app.localPlayer?.id) {
            this.context.mount.unmountLocal(this.id);
        }
        this.emitSyncEvent('occupancy', { occupiedBy: null });
        this.applySeatVisualState();
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

    public onReplicationEvent(eventType: string, data: unknown, _meta: IObjectReplicationMeta): void {
        if (eventType !== 'occupancy') return;
        const payload = data as IChairOccupancyPayload;
        if (!payload || (payload.occupiedBy !== null && typeof payload.occupiedBy !== 'string')) return;
        this.occupiedBy = payload.occupiedBy;
        if (!this.occupiedBy) {
            this.context.mount.unmountLocal(this.id);
        }
        this.applySeatVisualState();
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
        this.occupiedBy = payload.occupiedBy;
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
