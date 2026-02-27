import * as THREE from 'three';
import { PlayerEntity, IHandState } from './PlayerEntity';
import { IView } from '../interfaces/IView';
import { GameContext } from '../core/GameState';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { Skill } from '../skills/Skill';
import { MovementSkill } from '../skills/MovementSkill';
import { GrabSkill } from '../skills/GrabSkill';
import { StickFigureView, IPlayerViewState } from '../views/StickFigureView';
import { IPlayerEntityState, EntityType } from '../interfaces/IEntityState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

/**
 * Source of Truth: This entity owns the local player's spatial state (poses, origin, skills).
 * The RenderManager and Views must follow this state, never modify it directly.
 */
export class LocalPlayer extends PlayerEntity {
    public view: IView<IPlayerViewState>;
    public skills: Skill[] = [];
    public activeSkill: Skill | null = null;

    public xrOrigin: { position: IVector3, quaternion: IQuaternion };

    public _lastMoveVector: IVector3 = { x: 0, y: 0, z: 0 };
    public _leftControllerIndex: number = 0;
    public _rightControllerIndex: number = 1;

    constructor(public context: GameContext, id: string, spawnPos: IVector3, spawnYaw: number, view: IView<IPlayerViewState>) {
        super(context, id || 'local-player-id-temp', EntityType.LOCAL_PLAYER, true);
        this.isAuthority = true;
        this.view = view;

        this.view.mesh.userData.entityId = this.id;
        this.view.mesh.traverse(child => {
            child.userData.entityId = this.id;
        });

        this.xrOrigin = {
            position: { ...spawnPos },
            quaternion: { x: 0, y: Math.sin(spawnYaw / 2), z: 0, w: Math.cos(spawnYaw / 2) }
        };

        eventBus.on(EVENTS.AVATAR_CONFIG_UPDATED, (config: any) => {
            if (this.view) {
                this.view.setColor(config.color);
            }
        });

        this.initSkills(spawnYaw);
    }

    private initSkills(spawnYaw: number): void {
        const movement = new MovementSkill();
        movement.setYaw(spawnYaw);
        this.addSkill(movement);

        const grab = new GrabSkill();
        this.addSkill(grab);
        this.setActiveSkill('grab');
    }

    public addSkill(skill: Skill): void {
        this.skills.push(skill);
        if (skill.isAlwaysActive) {
            skill.activate(this);
        }
    }

    public setActiveSkill(id: string): void {
        if (this.activeSkill && !this.activeSkill.isAlwaysActive) {
            this.activeSkill.deactivate(this);
        }

        const skill = this.skills.find(s => s.id === id);
        if (skill && !skill.isAlwaysActive) {
            skill.activate(this);
            this.activeSkill = skill;
        }
    }

    public getSkill(id: string): Skill | undefined {
        return this.skills.find(s => s.id === id);
    }

    public update(delta: number, frame?: XRFrame): void {
        const managers = this.context.managers;
        const render = managers.render;
        const xr = managers.xr;

        for (const skill of this.skills) {
            if (skill.isAlwaysActive || skill === this.activeSkill) {
                skill.update(delta, this, managers);
            }
        }

        managers.tracking.update(delta, frame);

        // Calculate world pose from our own state (Source of Truth)
        // 1. Ensure camera world matrix is up to date with ANY movement that happened this frame (from Skills).
        // This prevents the "stale frame" jitter where poses are relative to the previous origin.
        if (render.cameraGroup) {
            render.cameraGroup.position.set(this.xrOrigin.position.x, this.xrOrigin.position.y, this.xrOrigin.position.z);
            render.cameraGroup.quaternion.set(this.xrOrigin.quaternion.x, this.xrOrigin.quaternion.y, this.xrOrigin.quaternion.z, this.xrOrigin.quaternion.w);
            render.cameraGroup.updateMatrixWorld(true);
        }

        const trackingState = managers.tracking.getState();
        const worldHeadPos = trackingState.head.position;
        const worldHeadQuat = trackingState.head.quaternion;
        const bodyYaw = trackingState.head.yaw;

        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const headQuatObj = new THREE.Quaternion(worldHeadQuat.x, worldHeadQuat.y, worldHeadQuat.z, worldHeadQuat.w);
        const localHeadQuat = bodyQuat.clone().invert().multiply(headQuatObj);

        // 2. Deep copy tracking data into our own persistent handStates to avoid state pollution
        this.syncHandStates(trackingState.hands);

        xr.transformHandsToAvatarSpace(
            this.xrOrigin,
            bodyYaw,
            worldHeadPos,
            this.handStates
        );

        this.view.applyState({
            position: { x: worldHeadPos.x, y: 0, z: worldHeadPos.z },
            yaw: bodyYaw,
            headHeight: worldHeadPos.y,
            headQuaternion: { x: localHeadQuat.x, y: localHeadQuat.y, z: localHeadQuat.z, w: localHeadQuat.w },
            handStates: this.handStates,
            name: this.name || 'You',
            color: this.context.avatarConfig.color,
            isLocal: true,
            audioLevel: managers.media ? managers.media.getLocalVolume() : 0,
            lerpFactor: 1.0
        }, delta);

        // Always emit state if this player is the authority, so that head and hand 
        // movements are synchronized even if locomotion input is zero.
        eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, this.getNetworkState());
    }

    // Removed updateVRHands — handled by TrackingManager and its Providers

    private syncHandStates(source: { left: IHandState, right: IHandState }): void {
        const copyHand = (src: IHandState, dst: IHandState) => {
            dst.active = src.active;
            dst.position.x = src.position.x;
            dst.position.y = src.position.y;
            dst.position.z = src.position.z;
            dst.quaternion.x = src.quaternion.x;
            dst.quaternion.y = src.quaternion.y;
            dst.quaternion.z = src.quaternion.z;
            dst.quaternion.w = src.quaternion.w;

            // Critical: Always sync joints if source has them, otherwise reset
            // This prevents the "stale joint" jitter if hand tracking is toggled
            for (let i = 0; i < 25; i++) {
                const sJ = src.joints[i];
                const dJ = dst.joints[i];
                dJ.position.x = sJ.position.x;
                dJ.position.y = sJ.position.y;
                dJ.position.z = sJ.position.z;
                dJ.quaternion.x = sJ.quaternion.x;
                dJ.quaternion.y = sJ.quaternion.y;
                dJ.quaternion.z = sJ.quaternion.z;
                dJ.quaternion.w = sJ.quaternion.w;
            }
        };
        copyHand(source.left, this.handStates.left);
        copyHand(source.right, this.handStates.right);
    }

    public getNetworkState(): IPlayerEntityState {
        const managers = this.context.managers;
        const render = managers.render;

        const trackingState = managers.tracking.getState();
        const worldHeadPos = trackingState.head.position;
        const worldHeadQuat = trackingState.head.quaternion;
        const bodyYaw = trackingState.head.yaw;

        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const headQuatObj = new THREE.Quaternion(worldHeadQuat.x, worldHeadQuat.y, worldHeadQuat.z, worldHeadQuat.w);
        const localHeadQuat = bodyQuat.clone().invert().multiply(headQuatObj);

        return {
            id: this.id,
            type: EntityType.LOCAL_PLAYER,
            n: this.name,
            p: [worldHeadPos.x, 0, worldHeadPos.z],
            y: bodyYaw,
            h: worldHeadPos.y,
            hq: [localHeadQuat.x, localHeadQuat.y, localHeadQuat.z, localHeadQuat.w],
            hands: JSON.parse(JSON.stringify(this.handStates)),
            conf: {
                color: this.context.avatarConfig.color
            },
            ownerId: this.ownerId
        };
    }

    public applyNetworkState(state: IPlayerEntityState): void {
        // LocalPlayer state is driven by input, not network updates.
        this.syncNetworkState(state);
    }

    public destroy(): void {
        super.destroy();
        for (const skill of this.skills) {
            skill.destroy();
        }
        this.skills = [];
        this.activeSkill = null;

        const render = this.context.managers.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
