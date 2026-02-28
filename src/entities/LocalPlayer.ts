import * as THREE from 'three';
import { PlayerEntity } from './PlayerEntity';
import { IView } from '../interfaces/IView';
import { GameContext } from '../core/GameState';
import { IVector3, IQuaternion, IPose } from '../interfaces/IMath';
import { Skill } from '../skills/Skill';
import { MovementSkill } from '../skills/MovementSkill';
import { GrabSkill } from '../skills/GrabSkill';
import { UIPointerSkill } from '../skills/UIPointerSkill';
import { StickFigureView, IPlayerViewState } from '../views/StickFigureView';
import { IPlayerEntityState, EntityType } from '../interfaces/IEntityState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IHandState } from '../interfaces/ITrackingProvider';
import { HumanoidState } from '../models/HumanoidState';
import { NetworkHumanoidDelta } from '../models/HumanoidState';

/**
 * Source of Truth: This entity owns the local player's spatial state (poses, origin, skills).
 * The RenderManager and Views must follow this state, never modify it directly.
 */
export class LocalPlayer extends PlayerEntity {
    public view: IView<IPlayerViewState>;
    public skills: Skill[] = [];
    public activeSkill: Skill | null = null;

    public humanoid = new HumanoidState();
    public xrOrigin: IPose;

    public _lastMoveVector: IVector3 = { x: 0, y: 0, z: 0 };
    public _leftControllerIndex: number = 0;
    public _rightControllerIndex: number = 1;
    private _lastProviderId: string | null = null;

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

        const uiPointer = new UIPointerSkill();
        this.addSkill(uiPointer);
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

        // 1. PHASE 1: Update Movement Only
        // This ensures the origin (xrOrigin) is at the latest position before we calculate world poses
        const movementSkill = this.getSkill('movement');
        if (movementSkill && (movementSkill.isAlwaysActive || movementSkill === this.activeSkill)) {
            movementSkill.update(delta, this, managers);
        }

        // 2. PHASE 2: Sync Origin to Render Objects
        // Critical for RenderManager.camera.getWorldPose() and tracking.update() to return
        // accurate world coordinates relative to the current frame's position.
        if (render.cameraGroup) {
            render.cameraGroup.position.set(this.xrOrigin.position.x, this.xrOrigin.position.y, this.xrOrigin.position.z);
            render.cameraGroup.quaternion.set(this.xrOrigin.quaternion.x, this.xrOrigin.quaternion.y, this.xrOrigin.quaternion.z, this.xrOrigin.quaternion.w);
            render.cameraGroup.updateMatrixWorld(true);
        }

        // 3. PHASE 3: Update Tracking
        // Poll tracking data NOW, using the fresh matrix.
        const providerId = managers.tracking.getActiveProviderId();
        if (this._lastProviderId !== providerId) {
            this._lastProviderId = providerId;
            this.humanoid.clearAll();
        }

        managers.tracking.update(delta, frame);

        const trackingState = managers.tracking.getState();
        const worldHeadPos = trackingState.head.pose.position;
        const worldHeadQuat = trackingState.head.pose.quaternion;
        const bodyYaw = trackingState.head.yaw;

        // Sync Humanoid state (XR Provider will populate the trackingState.humanoid buffer)
        if (trackingState.humanoidDelta) {
            this.humanoid.applyNetworkDelta(trackingState.humanoidDelta);
        }

        // NOTE: Local hand interaction state now lives solely in TrackingManager.getState().hands.
        // We intentionally avoid mirroring into PlayerEntity.handStates to prevent drift.

        this.headState.position = { ...worldHeadPos };
        this.headState.quaternion = { ...worldHeadQuat };
        this.headHeight = trackingState.head.pose.position.y;

        // NEW: Refine state with procedural animations (Desktop)
        if (managers.animation) {
            managers.animation.update(delta);
        }

        // 4. PHASE 4: Update All Other Skills (Grab, etc.)
        // These skills now see the latest tracking data and the latest origin within the SAME frame.
        for (const skill of this.skills) {
            if (skill.id === 'movement') continue; // Already updated in Phase 1
            if (skill.isAlwaysActive || skill === this.activeSkill) {
                skill.update(delta, this, managers);
            }
        }

        // 5. PHASE 5: Apply to View
        this.audioLevel = managers.media ? managers.media.getLocalVolume() : 0;
        this.micEnabled = this.context.voiceEnabled;

        this.view.applyState({
            position: { x: this.headState.position.x, y: 0, z: this.headState.position.z },
            yaw: bodyYaw,
            headHeight: this.headState.position.y,
            headQuaternion: this.headState.quaternion,
            humanoid: this.humanoid, // Pass the Humanoid state to StickFigureView
            name: this.name || 'You',
            color: this.context.avatarConfig.color,
            isLocal: true,
            audioLevel: this.audioLevel,
            lerpFactor: 1.0
        }, delta);

    }

    public getNetworkState(fullSync: boolean = false): IPlayerEntityState {
        const managers = this.context.managers;
        const trackingState = managers.tracking.getState();
        const bodyYaw = trackingState.head.yaw;

        return {
            id: this.id,
            type: EntityType.LOCAL_PLAYER,
            n: this.name,
            p: [this.headState.position.x, 0, this.headState.position.z],
            y: bodyYaw,
            h: this.headState.position.y,
            hq: [this.headState.quaternion.x, this.headState.quaternion.y, this.headState.quaternion.z, this.headState.quaternion.w],
            hmd: this.humanoid.consumeNetworkDelta(fullSync) || undefined,
            hm: [trackingState.hands.left.hasJoints ? 1 : 0, trackingState.hands.right.hasJoints ? 1 : 0],
            conf: {
                color: this.context.avatarConfig.color
            },
            mic: this.context.voiceEnabled,
            ownerId: this.ownerId
        };
    }

    public applyNetworkState(state: IPlayerEntityState): void {
        // LocalPlayer state is driven by input, not network updates.
    }

    public teleportTo(position: THREE.Vector3, yaw: number): void {
        const managers = this.context.managers;

        // 1. Move the xrOrigin base
        this.xrOrigin.position.x = position.x;
        this.xrOrigin.position.y = position.y;
        this.xrOrigin.position.z = position.z;

        this.xrOrigin.quaternion = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };

        // 2. Alert the movement skill to flush momentum and sync its internal orientation
        const movement = this.getSkill('movement') as MovementSkill;
        if (movement) {
            movement.setYaw(yaw);
            // In MovementSkill, locomotion intent is computed on-the-fly from _currentMove.
            // There is no persistent physics velocity vector to clear.
        }
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
