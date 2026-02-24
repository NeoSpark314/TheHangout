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
        
        // Push state to view
        const headWorldPos = { x: 0, y: 1.7, z: 0 }; // Default
        const bodyYaw = 0; // Default
        
        // Logic to extract world position from render camera if not in VR
        if (render.camera) {
            const camPos = (render.camera as any).position;
            headWorldPos.x = camPos.x;
            headWorldPos.y = camPos.y;
            headWorldPos.z = camPos.z;
        }

        this.view.applyState({
            position: this.xrOrigin.position,
            yaw: bodyYaw,
            headHeight: headWorldPos.y,
            headQuaternion: this.headPose.quaternion,
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
                    
                    // Simplified joints sync
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

    public getNetworkState(): any {
        return {
            id: this.id,
            type: this.type,
            name: this.name,
            position: this.xrOrigin.position,
            yaw: 0,
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
