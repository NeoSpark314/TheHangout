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

    constructor(id: string, spawnPos: Vector3, spawnYaw: number, view: IView<PlayerViewState>) {
        super(id || 'local-player-id-temp', 'LOCAL_PLAYER', true);
        this.view = view;

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

    public update(delta: number): void {
        const managers = gameState.managers;
        const render = managers.render;
        if (!render) return;

        for (const skill of this.skills) {
            if (skill.alwaysActive || skill === this.activeSkill) {
                skill.update(delta, this);
            }
        }

        this.updateVRHands();
        
        // 1. Correct Camera/Avatar alignment
        const headWorldPos = new THREE.Vector3();
        render.camera.getWorldPosition(headWorldPos);
        const finalHeadQuat = new THREE.Quaternion();
        render.camera.getWorldQuaternion(finalHeadQuat);
        const finalHeadEuler = new THREE.Euler().setFromQuaternion(finalHeadQuat, 'YXZ');

        const bodyYaw = finalHeadEuler.y;
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.clone().invert().multiply(finalHeadQuat);

        // 2. Transform hands to avatar space
        this.transformHandsToAvatarSpace(bodyYaw, headWorldPos);

        // 3. Push complete state to view
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

    private updateVRHands(): void {
        const render = gameState.managers.render;
        if (!render || !render.isXRPresenting()) {
            this.handStates.left.active = false;
            this.handStates.right.active = false;
            return;
        }

        const session = render.getXRSession();
        const frame = render.getXRFrame();
        const referenceSpace = render.getXRReferenceSpace();
        if (!session || !frame || !referenceSpace) return;

        for (const source of session.inputSources) {
            if (source.gripSpace) {
                const pose = frame.getPose(source.gripSpace, referenceSpace);
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
                            const jointPose = frame.getJointPose(joint, referenceSpace);
                            if (jointPose) {
                                handState.joints[i].position = { x: jointPose.transform.position.x, y: jointPose.transform.position.y, z: jointPose.transform.position.z };
                                handState.joints[i].quaternion = { x: jointPose.transform.orientation.x, y: jointPose.transform.orientation.y, z: jointPose.transform.orientation.z, w: jointPose.transform.orientation.w };
                            }
                            i++;
                        }
                    }
                }
            }
        }
    }

    private transformHandsToAvatarSpace(bodyYaw: number, headWorldPos: THREE.Vector3): void {
        const render = gameState.managers.render;
        if (!render) return;

        // Dummy group to help with worldToLocal without Three.js in PlayerEntity
        const avatarTransform = new THREE.Object3D();
        avatarTransform.position.set(headWorldPos.x, 0, headWorldPos.z);
        avatarTransform.rotation.y = bodyYaw;
        avatarTransform.updateMatrixWorld(true);

        const xrOriginMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
            new THREE.Quaternion(this.xrOrigin.quaternion.x, this.xrOrigin.quaternion.y, this.xrOrigin.quaternion.z, this.xrOrigin.quaternion.w)
        ).setPosition(this.xrOrigin.position.x, this.xrOrigin.position.y, this.xrOrigin.position.z);

        const processHand = (handPose: { position: Vector3, quaternion: Quaternion }, handState: HandState) => {
            if (!handState.active) return;

            // Transform pose from XR Reference Space to World Space
            const worldPos = new THREE.Vector3(handPose.position.x, handPose.position.y, handPose.position.z).applyMatrix4(xrOriginMatrix);
            const worldQuat = new THREE.Quaternion(handPose.quaternion.x, handPose.quaternion.y, handPose.quaternion.z, handPose.quaternion.w);
            const xrOriginQuat = new THREE.Quaternion(this.xrOrigin.quaternion.x, this.xrOrigin.quaternion.y, this.xrOrigin.quaternion.z, this.xrOrigin.quaternion.w);
            worldQuat.premultiply(xrOriginQuat);

            // World to Local (Avatar Space)
            const localPos = avatarTransform.worldToLocal(worldPos.clone());
            const invAvatarQuat = avatarTransform.quaternion.clone().invert();
            const localQuat = worldQuat.clone().premultiply(invAvatarQuat);

            handState.position = { x: localPos.x, y: localPos.y, z: localPos.z };
            handState.quaternion = { x: localQuat.x, y: localQuat.y, z: localQuat.z, w: localQuat.w };

            // Joints
            for (let i = 0; i < 25; i++) {
                const j = handState.joints[i];
                if (j.position.x !== 0 || j.position.y !== 0 || j.position.z !== 0) {
                    const jWorldPos = new THREE.Vector3(j.position.x, j.position.y, j.position.z).applyMatrix4(xrOriginMatrix);
                    const jWorldQuat = new THREE.Quaternion(j.quaternion.x, j.quaternion.y, j.quaternion.z, j.quaternion.w).premultiply(xrOriginQuat);
                    
                    const jLocalPos = avatarTransform.worldToLocal(jWorldPos);
                    const jLocalQuat = jWorldQuat.premultiply(invAvatarQuat);
                    
                    j.position = { x: jLocalPos.x, y: jLocalPos.y, z: jLocalPos.z };
                    j.quaternion = { x: jLocalQuat.x, y: jLocalQuat.y, z: jLocalQuat.z, w: jLocalQuat.w };
                }
            }
        };

        processHand(this.leftHandPose, this.handStates.left);
        processHand(this.rightHandPose, this.handStates.right);
    }

    public getNetworkState(): any {
        return {
            id: this.id,
            type: this.type,
            name: this.name,
            position: this.xrOrigin.position, // Dolly position
            yaw: 0, // Should be bodyYaw
            headHeight: 1.7,
            head: {
                position: this.headPose.position,
                quaternion: this.headPose.quaternion
            },
            hands: this.handStates,
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
