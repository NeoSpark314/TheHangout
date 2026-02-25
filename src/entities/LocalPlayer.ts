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

        this.updateVRHands(frame);

        // Calculate world pose from our own state (Source of Truth)
        let worldHeadPos: IVector3;
        let worldHeadQuat: IQuaternion;
        let bodyYaw: number;

        if (render.isXRPresenting()) {
            // In VR, the camera world pose IS the reference for our head
            const headPose = xr.getCameraWorldPose(render.camera);
            worldHeadPos = headPose.position;
            worldHeadQuat = headPose.quaternion;
            bodyYaw = headPose.yaw;
        } else {
            // In Desktop, our internal state drives the world pose
            const originPos = new THREE.Vector3(this.xrOrigin.position.x, this.xrOrigin.position.y, this.xrOrigin.position.z);
            const originQuat = new THREE.Quaternion(this.xrOrigin.quaternion.x, this.xrOrigin.quaternion.y, this.xrOrigin.quaternion.z, this.xrOrigin.quaternion.w);

            const localHeadPos = new THREE.Vector3(this.headState.position.x, this.headState.position.y, this.headState.position.z);
            const localHeadQuat = new THREE.Quaternion(this.headState.quaternion.x, this.headState.quaternion.y, this.headState.quaternion.z, this.headState.quaternion.w);

            const worldPos = localHeadPos.applyQuaternion(originQuat).add(originPos);
            const worldQuat = originQuat.clone().multiply(localHeadQuat);

            worldHeadPos = { x: worldPos.x, y: worldPos.y, z: worldPos.z };
            worldHeadQuat = { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w };

            const euler = new THREE.Euler().setFromQuaternion(originQuat, 'YXZ');
            bodyYaw = euler.y;
        }

        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const headQuatObj = new THREE.Quaternion(worldHeadQuat.x, worldHeadQuat.y, worldHeadQuat.z, worldHeadQuat.w);
        const localHeadQuat = bodyQuat.clone().invert().multiply(headQuatObj);

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

    private updateVRHands(frame?: XRFrame): void {
        const managers = this.context.managers;
        const render = managers.render;
        const xr = managers.xr;

        if (!render.isXRPresenting()) {
            this.handStates.left.active = false;
            this.handStates.right.active = false;
            return;
        }

        const session = render.getXRSession();
        const xrFrame = frame || render.getXRFrame();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !xrFrame || !referenceSpace) return;

        // Reset active state then poll
        this.handStates.left.active = false;
        this.handStates.right.active = false;

        let sourceIndex = 0;
        for (const source of session.inputSources) {
            if (source.handedness === 'left') {
                this._leftControllerIndex = sourceIndex;
                this.handStates.left.active = true;
            }
            if (source.handedness === 'right') {
                this._rightControllerIndex = sourceIndex;
                this.handStates.right.active = true;
            }
            sourceIndex++;
        }

        xr.updateHandPosesFromControllers(
            render,
            this.handStates,
            this._leftControllerIndex,
            this._rightControllerIndex
        );

        xr.updateJointsFromXRFrame(xrFrame, referenceSpace, session, this.handStates);
    }

    public getNetworkState(): IPlayerEntityState {
        const managers = this.context.managers;
        const render = managers.render;

        let worldHeadPos: IVector3;
        let worldHeadQuat: IQuaternion;
        let bodyYaw: number;

        if (render.isXRPresenting()) {
            const headPose = managers.xr.getCameraWorldPose(render.camera);
            worldHeadPos = headPose.position;
            worldHeadQuat = headPose.quaternion;
            bodyYaw = headPose.yaw;
        } else {
            const originPos = new THREE.Vector3(this.xrOrigin.position.x, this.xrOrigin.position.y, this.xrOrigin.position.z);
            const originQuat = new THREE.Quaternion(this.xrOrigin.quaternion.x, this.xrOrigin.quaternion.y, this.xrOrigin.quaternion.z, this.xrOrigin.quaternion.w);
            const localHeadPos = new THREE.Vector3(this.headState.position.x, this.headState.position.y, this.headState.position.z);
            const localHeadQuat = new THREE.Quaternion(this.headState.quaternion.x, this.headState.quaternion.y, this.headState.quaternion.z, this.headState.quaternion.w);
            const worldPos = localHeadPos.applyQuaternion(originQuat).add(originPos);
            const worldQuat = originQuat.clone().multiply(localHeadQuat);
            worldHeadPos = { x: worldPos.x, y: worldPos.y, z: worldPos.z };
            worldHeadQuat = { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w };
            const euler = new THREE.Euler().setFromQuaternion(originQuat, 'YXZ');
            bodyYaw = euler.y;
        }

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
