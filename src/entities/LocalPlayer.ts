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
                (this.view as any).setColor(config.color);
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

        for (const skill of this.skills) {
            if (skill.alwaysActive || skill === this.activeSkill) {
                skill.update(delta, this);
            }
        }

        this.updateVRHands(frame);
        
        const headWorldPos = new THREE.Vector3();
        render.camera.getWorldPosition(headWorldPos);
        const headWorldQuat = new THREE.Quaternion();
        render.camera.getWorldQuaternion(headWorldQuat);
        const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');

        const bodyYaw = headEuler.y;
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.clone().invert().multiply(headWorldQuat);

        this.transformHandsToAvatarSpace(bodyYaw, headWorldPos);

        this.view.applyState({
            position: { x: headWorldPos.x, y: 0, z: headWorldPos.z },
            yaw: bodyYaw,
            headHeight: headWorldPos.y,
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
        if (!render.isXRPresenting()) {
            this.handStates.left.active = false;
            this.handStates.right.active = false;
            return;
        }

        const session = render.getXRSession();
        const xrFrame = frame || render.getXRFrame();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !xrFrame || !referenceSpace) return;

        let sourceIndex = 0;
        for (const source of session.inputSources) {
            if (source.handedness === 'left') this._leftControllerIndex = sourceIndex;
            if (source.handedness === 'right') this._rightControllerIndex = sourceIndex;
            
            if (source.gripSpace) {
                const pose = xrFrame.getPose(source.gripSpace, referenceSpace);
                if (pose) {
                    const handState = source.handedness === 'left' ? this.handStates.left : this.handStates.right;
                    const handPoseObj = source.handedness === 'left' ? this.leftHandPose : this.rightHandPose;

                    handState.active = true;
                    handPoseObj.position = { x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z };
                    handPoseObj.quaternion = { x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w };
                    
                    if (source.hand) {
                        let i = 0;
                        for (const joint of source.hand.values()) {
                            if (i >= 25) break;
                            const jointPose = xrFrame.getJointPose(joint, referenceSpace);
                            if (jointPose) {
                                handState.joints[i].position = { x: jointPose.transform.position.x, y: jointPose.transform.position.y, z: jointPose.transform.position.z };
                                handState.joints[i].quaternion = { x: jointPose.transform.orientation.x, y: jointPose.transform.orientation.y, z: jointPose.transform.orientation.z, w: jointPose.transform.orientation.w };
                            }
                            i++;
                        }
                    }
                }
            }
            sourceIndex++;
        }
    }

    private transformHandsToAvatarSpace(bodyYaw: number, headWorldPos: THREE.Vector3): void {
        const managers = gameState.managers;
        const render = managers.render;
        
        const avatarTransform = new THREE.Object3D();
        avatarTransform.position.set(headWorldPos.x, 0, headWorldPos.z);
        avatarTransform.rotation.y = bodyYaw;
        avatarTransform.updateMatrixWorld(true);

        const processHand = (handPose: { position: Vector3, quaternion: Quaternion }, handState: HandState, controllerIndex: number) => {
            if (!handState.active) return;

            // Get controller from THREE.js
            const controller = render.getXRController(controllerIndex);
            const worldPos = new THREE.Vector3();
            const worldQuat = new THREE.Quaternion();
            controller.getWorldPosition(worldPos);
            controller.getWorldQuaternion(worldQuat);

            const localPos = avatarTransform.worldToLocal(worldPos.clone());
            const localQuat = worldQuat.clone().premultiply(avatarTransform.quaternion.clone().invert());

            handState.position = { x: localPos.x, y: localPos.y, z: localPos.z };
            handState.quaternion = { x: localQuat.x, y: localQuat.y, z: localQuat.z, w: localQuat.w };

            // Joints are already in reference space from updateVRHands, but they need to be world-transformed
            // and then local-transformed to avatar space.
            // However, a simpler way is to use the same logic as the hand if we have the xrOrigin
            const xrOriginQuat = new THREE.Quaternion(this.xrOrigin.quaternion.x, this.xrOrigin.quaternion.y, this.xrOrigin.quaternion.z, this.xrOrigin.quaternion.w);
            const xrOriginMatrix = new THREE.Matrix4().makeRotationFromQuaternion(xrOriginQuat).setPosition(this.xrOrigin.position.x, this.xrOrigin.position.y, this.xrOrigin.position.z);

            for (let i = 0; i < 25; i++) {
                const j = handState.joints[i];
                if (j.position.x !== 0 || j.position.y !== 0 || j.position.z !== 0) {
                    const jWorldPos = new THREE.Vector3(j.position.x, j.position.y, j.position.z).applyMatrix4(xrOriginMatrix);
                    const jWorldQuat = new THREE.Quaternion(j.quaternion.x, j.quaternion.y, j.quaternion.z, j.quaternion.w).premultiply(xrOriginQuat);
                    const jLocalPos = avatarTransform.worldToLocal(jWorldPos);
                    const jLocalQuat = jWorldQuat.premultiply(avatarTransform.quaternion.clone().invert());
                    j.position = { x: jLocalPos.x, y: jLocalPos.y, z: jLocalPos.z };
                    j.quaternion = { x: jLocalQuat.x, y: jLocalQuat.y, z: jLocalQuat.z, w: jLocalQuat.w };
                }
            }
        };

        processHand(this.leftHandPose, this.handStates.left, this._leftControllerIndex);
        processHand(this.rightHandPose, this.handStates.right, this._rightControllerIndex);
    }

    public getNetworkState(): any {
        const render = gameState.managers.render;
        if (!render) return {};

        const headWorldPos = new THREE.Vector3();
        render.camera.getWorldPosition(headWorldPos);
        const headWorldQuat = new THREE.Quaternion();
        render.camera.getWorldQuaternion(headWorldQuat);
        const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');
        const bodyYaw = headEuler.y;
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.clone().invert().multiply(headWorldQuat);

        return {
            id: this.id,
            type: this.type,
            name: this.name,
            position: { x: headWorldPos.x, y: 0, z: headWorldPos.z },
            yaw: bodyYaw,
            headHeight: headWorldPos.y,
            head: {
                position: { x: headWorldPos.x, y: headWorldPos.y, z: headWorldPos.z },
                quaternion: { x: localHeadQuat.x, y: localHeadQuat.y, z: localHeadQuat.z, w: localHeadQuat.w }
            },
            hands: JSON.parse(JSON.stringify(this.handStates)), // Deep copy to prevent ref issues
            avatarConfig: gameState.avatarConfig
        };
    }

    public applyNetworkState(state: any): void {}

    public destroy(): void {
        super.destroy();
        for (const skill of this.skills) {
            skill.destroy();
        }
        this.skills = [];
        this.activeSkill = null;

        const render = gameState.managers.render;
        if (render && this.view) {
            (this.view as any).removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
