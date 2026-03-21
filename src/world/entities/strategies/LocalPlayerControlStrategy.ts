import * as THREE from 'three';
import type { IVector3, IPose } from '../../../shared/contracts/IMath';
import type { IPlayerEntityState } from '../../../shared/contracts/IEntityState';
import { EntityType } from '../../../shared/contracts/IEntityState';
import type { Skill } from '../../../skills/Skill';
import { MovementSkill } from '../../../skills/MovementSkill';
import { GrabSkill } from '../../../skills/GrabSkill';
import { UIPointerSkill } from '../../../skills/UIPointerSkill';
import type { PlayerAvatarEntity } from '../PlayerAvatarEntity';
import type { IPlayerAvatarControlStrategy } from './IPlayerAvatarControlStrategy';

export interface ILocalPlayerTeleportOptions {
    // `player` places the user's floor anchor at the target while keeping the current origin Y.
    // `head` places the actual HMD at the target, including Y.
    targetSpace?: 'player' | 'head';
}

export class LocalPlayerControlStrategy implements IPlayerAvatarControlStrategy {
    public readonly mode = 'local';

    public xrOrigin!: IPose;
    private skills: Skill[] = [];
    private activeSkill: Skill | null = null;
    private lastProviderId: string | null = null;

    public attach(player: PlayerAvatarEntity): void {
        this.xrOrigin = {
            position: { ...player.spawnPosition },
            quaternion: {
                x: 0,
                y: Math.sin(player.spawnYaw / 2),
                z: 0,
                w: Math.cos(player.spawnYaw / 2)
            }
        };

        this.initializeSkills(player);
    }

    public detach(player: PlayerAvatarEntity): void {
        for (const skill of this.skills) {
            skill.destroy();
        }
        this.skills = [];
        this.activeSkill = null;
        this.lastProviderId = null;
    }

    public update(player: PlayerAvatarEntity, delta: number, frame?: XRFrame): void {
        const runtime = player.appContext.runtime;
        const render = runtime.render;

        const movementSkill = this.getSkill('movement');
        if (movementSkill && (movementSkill.isAlwaysActive || movementSkill === this.activeSkill)) {
            movementSkill.update(delta, player, runtime);
        }

        if (render.cameraGroup) {
            render.cameraGroup.position.set(this.xrOrigin.position.x, this.xrOrigin.position.y, this.xrOrigin.position.z);
            render.cameraGroup.quaternion.set(
                this.xrOrigin.quaternion.x,
                this.xrOrigin.quaternion.y,
                this.xrOrigin.quaternion.z,
                this.xrOrigin.quaternion.w
            );
            render.cameraGroup.updateMatrixWorld(true);
        }

        const providerId = runtime.tracking.getActiveProviderId();
        if (this.lastProviderId !== providerId) {
            this.lastProviderId = providerId;
            player.humanoid.clearAll();
        }

        runtime.tracking.update(delta, frame);
        runtime.input?.processInteractions();

        const trackingState = runtime.tracking.getState();
        const worldHeadPos = trackingState.head.pose.position;
        const worldHeadQuat = trackingState.head.pose.quaternion;
        const bodyYaw = trackingState.head.yaw;

        if (trackingState.humanoidDelta) {
            player.humanoid.applyNetworkDelta(trackingState.humanoidDelta);
        }

        player.headState.position = { ...worldHeadPos };
        player.headState.quaternion = { ...worldHeadQuat };
        player.headHeight = trackingState.head.pose.position.y;

        if (runtime.animation) {
            runtime.animation.update(delta);
        }

        for (const skill of this.skills) {
            if (skill.id === 'movement') continue;
            if (skill.isAlwaysActive || skill === this.activeSkill) {
                skill.update(delta, player, runtime);
            }
        }

        player.audioLevel = runtime.media ? runtime.media.getLocalVolume() : 0;
        player.micEnabled = player.appContext.voiceEnabled;

        player.view.applyState({
            position: { x: player.headState.position.x, y: 0, z: player.headState.position.z },
            yaw: bodyYaw,
            headHeight: player.headState.position.y,
            headQuaternion: player.headState.quaternion,
            humanoid: player.humanoid,
            name: player.name || 'You',
            color: player.avatarConfigSnapshot.color,
            isLocal: true,
            audioLevel: player.audioLevel,
            lerpFactor: 1.0
        }, delta);
    }

    public getNetworkState(player: PlayerAvatarEntity, fullSync: boolean = false): IPlayerEntityState {
        const runtime = player.appContext.runtime;
        const trackingState = runtime.tracking.getState();
        const bodyYaw = trackingState.head.yaw;

        return {
            id: player.id,
            type: EntityType.PLAYER_AVATAR,
            n: player.name,
            p: [player.headState.position.x, 0, player.headState.position.z],
            y: bodyYaw,
            h: player.headState.position.y,
            hq: [
                player.headState.quaternion.x,
                player.headState.quaternion.y,
                player.headState.quaternion.z,
                player.headState.quaternion.w
            ],
            hmd: player.humanoid.consumeNetworkDelta(fullSync) || undefined,
            hm: [trackingState.hands.left.hasJoints ? 1 : 0, trackingState.hands.right.hasJoints ? 1 : 0],
            conf: {
                color: player.avatarConfigSnapshot.color,
                renderMode: player.avatarConfigSnapshot.renderMode,
                vrmUrl: player.avatarConfigSnapshot.vrmUrl
            },
            mic: player.appContext.voiceEnabled,
            ownerId: player.ownerId
        };
    }

    public destroy(player: PlayerAvatarEntity): void {
        this.detach(player);
    }

    public addSkill(player: PlayerAvatarEntity, skill: Skill): void {
        this.skills.push(skill);
        if (skill.isAlwaysActive) {
            skill.activate(player);
        }
    }

    public setActiveSkill(player: PlayerAvatarEntity, id: string): void {
        if (this.activeSkill && !this.activeSkill.isAlwaysActive) {
            this.activeSkill.deactivate(player);
        }

        const skill = this.skills.find((candidate) => candidate.id === id);
        if (skill && !skill.isAlwaysActive) {
            skill.activate(player);
            this.activeSkill = skill;
        }
    }

    public getSkill(id: string): Skill | undefined {
        return this.skills.find((skill) => skill.id === id);
    }

    public moveOriginTo(position: THREE.Vector3, yaw: number): void {
        this.xrOrigin.position.x = position.x;
        this.xrOrigin.position.y = position.y;
        this.xrOrigin.position.z = position.z;
        this.xrOrigin.quaternion = {
            x: 0,
            y: Math.sin(yaw / 2),
            z: 0,
            w: Math.cos(yaw / 2)
        };
    }

    public teleportTo(player: PlayerAvatarEntity, position: THREE.Vector3, yaw: number, options: ILocalPlayerTeleportOptions = {}): void {
        const runtime = player.appContext.runtime;
        const targetSpace = options.targetSpace || 'player';

        const localHeadOffset = new THREE.Vector3().copy(runtime.render.camera.position);
        const localHeadEuler = new THREE.Euler().setFromQuaternion(runtime.render.camera.quaternion, 'YXZ');
        const localHeadYaw = localHeadEuler.y;

        const targetOriginYaw = yaw - localHeadYaw;
        const targetOriginQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetOriginYaw);
        const worldHeadOffset = localHeadOffset.applyQuaternion(targetOriginQuat);

        this.xrOrigin.position.x = position.x - worldHeadOffset.x;
        this.xrOrigin.position.z = position.z - worldHeadOffset.z;

        if (targetSpace === 'head') {
            this.xrOrigin.position.y = position.y - worldHeadOffset.y;
        }

        this.xrOrigin.quaternion = {
            x: 0,
            y: Math.sin(targetOriginYaw / 2),
            z: 0,
            w: Math.cos(targetOriginYaw / 2)
        };

        const movement = this.getSkill('movement') as MovementSkill | undefined;
        movement?.setYaw(targetOriginYaw);
    }

    private initializeSkills(player: PlayerAvatarEntity): void {
        const movement = new MovementSkill();
        movement.setYaw(player.spawnYaw);
        this.addSkill(player, movement);

        const grab = new GrabSkill();
        this.addSkill(player, grab);
        this.setActiveSkill(player, 'grab');

        const uiPointer = new UIPointerSkill();
        this.addSkill(player, uiPointer);
    }
}
