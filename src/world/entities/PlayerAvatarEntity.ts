import * as THREE from 'three';
import { ReplicatedEntity } from './ReplicatedEntity';
import { AppContext } from '../../app/AppContext';
import { IPose, IVector3 } from '../../shared/contracts/IMath';
import { IView } from '../../shared/contracts/IView';
import { IPlayerEntityState } from '../../shared/contracts/IEntityState';
import { HumanoidState } from '../../shared/types/HumanoidState';
import type { Skill } from '../../skills/Skill';
import type { IPlayerAvatarControlStrategy } from './strategies/IPlayerAvatarControlStrategy';
import type { IPlayerAvatarRenderState } from '../../render/avatar/IPlayerAvatarRenderState';
import type { ILocalPlayerTeleportOptions } from './strategies/LocalPlayerControlStrategy';
import type { IAudioChunkPayload } from '../../shared/contracts/IVoice';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { IAvatarConfig, normalizeAvatarConfig } from '../../shared/contracts/IAvatar';
import { AvatarSkeletonState } from '../../shared/avatar/AvatarSkeletonState';
import { AVATAR_SKELETON_JOINTS, AVATAR_SKELETON_PARENT, AvatarSkeletonJointName } from '../../shared/avatar/AvatarSkeleton';
import { composeAvatarWorldPoses } from '../../shared/avatar/AvatarSkeletonUtils';

export class PlayerAvatarEntity extends ReplicatedEntity {
    public static readonly DEFAULT_HEAD_HEIGHT = 1.7;
    public name: string = '';
    public headHeight: number = PlayerAvatarEntity.DEFAULT_HEAD_HEIGHT;
    public headState: IPose;
    public micEnabled: boolean = true;
    public audioLevel: number = 0;
    public isMuted: boolean = false;
    public view: IView<IPlayerAvatarRenderState>;
    public humanoid = new HumanoidState();
    public avatarSkeleton = new AvatarSkeletonState();
    public readonly controlMode: 'local' | 'remote';
    public readonly spawnPosition: IVector3;
    public readonly spawnYaw: number;
    public readonly peerId: string;
    public targetPosition: IVector3 = { x: 0, y: 5, z: 0 };
    public targetYaw: number = 0;
    public avatarConfigSnapshot: IAvatarConfig;
    public _lastMoveVector: IVector3 = { x: 0, y: 0, z: 0 };
    public _leftControllerIndex: number = 0;
    public _rightControllerIndex: number = 1;
    private readonly avatarConfigListener?: (config: IAvatarConfig) => void;
    private controlStrategy: IPlayerAvatarControlStrategy | null = null;
    private fallbackOrigin: IPose;

    constructor(
        protected context: AppContext,
        id: string,
        type: string,
        isAuthority: boolean,
        view: IView<IPlayerAvatarRenderState>,
        options: {
            controlMode: 'local' | 'remote';
            spawnPos?: IVector3;
            spawnYaw?: number;
            avatarConfig?: Partial<IAvatarConfig>;
        }
    ) {
        super(context, id, type, isAuthority);
        this.view = view;
        this.controlMode = options.controlMode;
        this.spawnPosition = options.spawnPos ? { ...options.spawnPos } : { x: 0, y: 0, z: 0 };
        this.spawnYaw = options.spawnYaw ?? 0;
        this.peerId = id;
        this.avatarConfigSnapshot = normalizeAvatarConfig(
            options.avatarConfig || (this.controlMode === 'local' ? this.context.avatarConfig : undefined)
        );

        this.headState = {
            position: { x: 0, y: PlayerAvatarEntity.DEFAULT_HEAD_HEIGHT, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
        this.fallbackOrigin = {
            position: { ...this.spawnPosition },
            quaternion: { x: 0, y: Math.sin(this.spawnYaw / 2), z: 0, w: Math.cos(this.spawnYaw / 2) }
        };

        this.view.mesh.userData.entityId = this.id;
        this.view.mesh.traverse((child) => {
            child.userData.entityId = this.id;
        });

        if (this.controlMode === 'local') {
            this.avatarConfigListener = (config) => {
                this.setAvatarConfig(config);
            };
            eventBus.on(EVENTS.AVATAR_CONFIG_UPDATED, this.avatarConfigListener);
        }

        this.setAvatarConfig(this.avatarConfigSnapshot);
    }

    public attachControlStrategy(strategy: IPlayerAvatarControlStrategy): void {
        if (this.controlStrategy) {
            this.controlStrategy.detach(this);
        }
        this.controlStrategy = strategy;
        this.controlStrategy.attach(this);
    }

    public get xrOrigin(): IPose {
        return this.controlStrategy?.xrOrigin || this.fallbackOrigin;
    }

    public get appContext(): AppContext {
        return this.context;
    }

    public addSkill(skill: Skill): void {
        this.controlStrategy?.addSkill?.(this, skill);
    }

    public setActiveSkill(id: string): void {
        this.controlStrategy?.setActiveSkill?.(this, id);
    }

    public getSkill(id: string): Skill | undefined {
        return this.controlStrategy?.getSkill?.(id);
    }

    public update(delta: number, frame?: XRFrame): void {
        this.controlStrategy?.update(this, delta, frame);
    }

    public getNetworkState(fullSync: boolean = false): IPlayerEntityState | null {
        return this.controlStrategy?.getNetworkState(this, fullSync) || null;
    }

    public applyNetworkState(state: IPlayerEntityState): void {
        this.controlStrategy?.applyNetworkState?.(this, state);
    }

    public setAvatarConfig(config: Partial<IAvatarConfig>): void {
        this.avatarConfigSnapshot = normalizeAvatarConfig({
            ...this.avatarConfigSnapshot,
            ...config
        });
        this.view.setColor(this.avatarConfigSnapshot.color);
        (this.view as unknown as { setAvatarConfig?: (next: IAvatarConfig) => void }).setAvatarConfig?.(this.avatarConfigSnapshot);
    }

    public moveOriginTo(position: THREE.Vector3, yaw: number): void {
        this.controlStrategy?.moveOriginTo?.(position, yaw);
    }

    public teleportTo(position: THREE.Vector3, yaw: number, options: ILocalPlayerTeleportOptions = {}): void {
        this.controlStrategy?.teleportTo?.(this, position, yaw, options);
    }

    public onAudioChunk(payload: IAudioChunkPayload): void {
        this.controlStrategy?.onAudioChunk?.(this, payload);
    }

    public destroy(): void {
        super.destroy();
        this.controlStrategy?.destroy(this);
        this.controlStrategy = null;

        if (this.avatarConfigListener) {
            eventBus.off(EVENTS.AVATAR_CONFIG_UPDATED, this.avatarConfigListener);
        }

        const render = this.context.runtime.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }

    public getAvatarHeadWorldPose(): IPose | null {
        const head = composeAvatarWorldPoses(this.avatarSkeleton.pose).head;
        if (!head) return null;
        return {
            position: { x: head.position.x, y: head.position.y, z: head.position.z },
            quaternion: { x: head.quaternion.x, y: head.quaternion.y, z: head.quaternion.z, w: head.quaternion.w }
        };
    }

    public getAvatarJointWorldPosition(jointName: AvatarSkeletonJointName): IVector3 | null {
        const joint = composeAvatarWorldPoses(this.avatarSkeleton.pose)[jointName];
        if (!joint) return null;
        return { x: joint.position.x, y: joint.position.y, z: joint.position.z };
    }

    public getAvatarJointWorldQuaternion(jointName: AvatarSkeletonJointName): IPose['quaternion'] | null {
        const joint = composeAvatarWorldPoses(this.avatarSkeleton.pose)[jointName];
        if (!joint) return null;
        return { x: joint.quaternion.x, y: joint.quaternion.y, z: joint.quaternion.z, w: joint.quaternion.w };
    }

    public setAvatarJointWorldPose(
        jointName: AvatarSkeletonJointName,
        pose: IPose,
        tracked: boolean = true
    ): void {
        const world = composeAvatarWorldPoses(this.avatarSkeleton.pose);
        const parentName = AVATAR_SKELETON_PARENT[jointName];
        const parentPosition = parentName
            ? world[parentName]?.position || new THREE.Vector3(this.avatarSkeleton.pose.rootWorldPosition.x, this.avatarSkeleton.pose.rootWorldPosition.y, this.avatarSkeleton.pose.rootWorldPosition.z)
            : new THREE.Vector3(this.avatarSkeleton.pose.rootWorldPosition.x, this.avatarSkeleton.pose.rootWorldPosition.y, this.avatarSkeleton.pose.rootWorldPosition.z);
        const parentQuaternion = parentName
            ? world[parentName]?.quaternion || new THREE.Quaternion(this.avatarSkeleton.pose.rootWorldQuaternion.x, this.avatarSkeleton.pose.rootWorldQuaternion.y, this.avatarSkeleton.pose.rootWorldQuaternion.z, this.avatarSkeleton.pose.rootWorldQuaternion.w)
            : new THREE.Quaternion(this.avatarSkeleton.pose.rootWorldQuaternion.x, this.avatarSkeleton.pose.rootWorldQuaternion.y, this.avatarSkeleton.pose.rootWorldQuaternion.z, this.avatarSkeleton.pose.rootWorldQuaternion.w);
        const inverseParentQuaternion = parentQuaternion.clone().invert();
        const localPosition = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z)
            .sub(parentPosition)
            .applyQuaternion(inverseParentQuaternion);
        const localQuaternion = inverseParentQuaternion.multiply(
            new THREE.Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w)
        );

        this.avatarSkeleton.setJointLocalPose(jointName, {
            position: { x: localPosition.x, y: localPosition.y, z: localPosition.z },
            quaternion: { x: localQuaternion.x, y: localQuaternion.y, z: localQuaternion.z, w: localQuaternion.w }
        }, tracked);
    }

    public syncLegacyPoseFromSkeleton(): void {
        const snapshot = this.avatarSkeleton.pose;
        const world = composeAvatarWorldPoses(snapshot);

        this.targetPosition = { x: snapshot.rootWorldPosition.x, y: snapshot.rootWorldPosition.y, z: snapshot.rootWorldPosition.z };
        const rootQuat = new THREE.Quaternion(
            snapshot.rootWorldQuaternion.x,
            snapshot.rootWorldQuaternion.y,
            snapshot.rootWorldQuaternion.z,
            snapshot.rootWorldQuaternion.w
        );
        this.targetYaw = new THREE.Euler().setFromQuaternion(rootQuat, 'YXZ').y;

        const headWorld = world.head;
        if (headWorld) {
            this.headState.position = {
                x: headWorld.position.x,
                y: headWorld.position.y,
                z: headWorld.position.z
            };
            this.headState.quaternion = {
                x: headWorld.quaternion.x,
                y: headWorld.quaternion.y,
                z: headWorld.quaternion.z,
                w: headWorld.quaternion.w
            };
            this.headHeight = Math.max(0.4, headWorld.position.y - snapshot.rootWorldPosition.y);
        }

        this.humanoid.clearAll();
        for (const jointName of AVATAR_SKELETON_JOINTS) {
            const jointWorld = world[jointName];
            if (!jointWorld) continue;
            this.humanoid.setJointPose(
                jointName,
                { x: jointWorld.position.x, y: jointWorld.position.y, z: jointWorld.position.z },
                { x: jointWorld.quaternion.x, y: jointWorld.quaternion.y, z: jointWorld.quaternion.z, w: jointWorld.quaternion.w }
            );
        }
        this.humanoid.consumeNetworkDelta();
    }
}
