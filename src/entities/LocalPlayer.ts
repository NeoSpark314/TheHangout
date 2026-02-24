import * as THREE from 'three';
import { PlayerEntity, HandState } from './PlayerEntity';
import { IView } from '../interfaces/IView';
import { Vector3, Quaternion } from '../interfaces/IMath';
import { Skill } from '../skills/Skill';
import { MovementSkill } from '../skills/MovementSkill';
import { GrabSkill } from '../skills/GrabSkill';
import { PlayerViewState } from '../views/StickFigureView';
import gameState from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

export class LocalPlayer extends PlayerEntity {
    public view: IView<PlayerViewState>;
    public skills: Skill[] = [];
    public activeSkill: Skill | null = null;
    
    public xrOrigin: { position: Vector3, quaternion: Quaternion };
    public headPose: { position: Vector3, quaternion: Quaternion };
    public leftHandPose: { position: Vector3, quaternion: Quaternion };
    public rightHandPose: { position: Vector3, quaternion: Quaternion };

    public _lastMoveVector: Vector3 = { x: 0, y: 0, z: 0 };
    private _leftControllerIndex: number = 0;
    private _rightControllerIndex: number = 1;

    constructor(id: string, spawnPos: Vector3, spawnYaw: number, view: IView<PlayerViewState>) {
        super(id || 'local-player-id-temp', 'LOCAL_PLAYER', true);
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

        this.headPose = {
            position: { x: 0, y: 1.7, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };

        this.leftHandPose = {
            position: { x: -0.35, y: 1.1, z: -0.4 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };

        this.rightHandPose = {
            position: { x: 0.35, y: 1.1, z: -0.4 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
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
        if (skill.alwaysActive) {
            skill.activate(this);
        }
    }

    public setActiveSkill(id: string): void {
        if (this.activeSkill && !this.activeSkill.alwaysActive) {
            this.activeSkill.deactivate(this);
        }

        const skill = this.skills.find(s => s.id === id);
        if (skill && !skill.alwaysActive) {
            skill.activate(this);
            this.activeSkill = skill;
        }
    }

    public getSkill(id: string): Skill | undefined {
        return this.skills.find(s => s.id === id);
    }

    public update(delta: number, frame?: XRFrame): void {
        const managers = gameState.managers;
        const render = managers.render;
        const xr = managers.xr;

        for (const skill of this.skills) {
            if (skill.alwaysActive || skill === this.activeSkill) {
                skill.update(delta, this);
            }
        }

        this.updateVRHands(frame);
        
        const headPose = xr.getCameraWorldPose(render.camera);
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, headPose.yaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.clone().invert().multiply(new THREE.Quaternion(headPose.quaternion.x, headPose.quaternion.y, headPose.quaternion.z, headPose.quaternion.w));

        xr.transformHandsToAvatarSpace(
            this.xrOrigin,
            headPose.yaw,
            headPose.position,
            this.handStates
        );

        this.view.applyState({
            position: { x: headPose.position.x, y: 0, z: headPose.position.z },
            yaw: headPose.yaw,
            headHeight: headPose.position.y,
            headQuaternion: { x: localHeadQuat.x, y: localHeadQuat.y, z: localHeadQuat.z, w: localHeadQuat.w },
            handStates: this.handStates,
            name: this.name,
            color: gameState.avatarConfig.color,
            isLocal: true,
            audioLevel: managers.media ? managers.media.getLocalVolume() : 0,
            lerpFactor: 1.0
        }, delta);

        if (Math.pow(this._lastMoveVector.x, 2) + Math.pow(this._lastMoveVector.y, 2) + Math.pow(this._lastMoveVector.z, 2) > 0) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, this.getNetworkState());
        }
    }

    private updateVRHands(frame?: XRFrame): void {
        const managers = gameState.managers;
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
            this.leftHandPose,
            this.rightHandPose,
            this.handStates,
            this._leftControllerIndex,
            this._rightControllerIndex
        );

        xr.updateJointsFromXRFrame(xrFrame, referenceSpace, session, this.handStates);
    }

    public getNetworkState(): any {
        const managers = gameState.managers;
        const headPose = managers.xr.getCameraWorldPose(managers.render.camera);
        
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, headPose.yaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.clone().invert().multiply(new THREE.Quaternion(headPose.quaternion.x, headPose.quaternion.y, headPose.quaternion.z, headPose.quaternion.w));

        return {
            id: this.id,
            type: this.type,
            name: this.name,
            position: { x: headPose.position.x, y: 0, z: headPose.position.z },
            yaw: headPose.yaw,
            headHeight: headPose.position.y,
            head: {
                position: headPose.position,
                quaternion: { x: localHeadQuat.x, y: localHeadQuat.y, z: localHeadQuat.z, w: localHeadQuat.w }
            },
            hands: JSON.parse(JSON.stringify(this.handStates)),
            avatarConfig: gameState.avatarConfig
        };
    }

    public destroy(): void {
        super.destroy();
        for (const skill of this.skills) {
            skill.destroy();
        }
        this.skills = [];
        this.activeSkill = null;

        const render = gameState.managers.render;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
