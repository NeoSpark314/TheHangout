import { PlayerEntity, HandState } from './PlayerEntity';
import { IView } from '../interfaces/IView';
import { Vector3, Quaternion } from '../interfaces/IMath';
import { Skill } from '../skills/Skill';
import { PlayerViewState } from '../views/StickFigureView';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class LocalPlayer extends PlayerEntity {
    public view: IView<PlayerViewState>;
    public skills: Skill[] = [];
    public activeSkill: Skill | null = null;
    
    // Logic-only transforms
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
                this.view.setHighlight(false); // Placeholder or specific method
                (this.view as any).setColor(config.color);
            }
        });
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
        const managers = (gameState as any).managers;
        if (!managers.render) return;

        // 1. Update skills
        for (const skill of this.skills) {
            if (skill.alwaysActive || skill === this.activeSkill) {
                skill.update(delta, this);
            }
        }

        // 2. Map VR Hands (Should be moved to a manager)
        this.updateVRHands();

        // 3. Update view
        // Logic for computing headWorldPos and bodyYaw would ideally be here 
        // but without Three.js it needs to be carefully handled.
        // For now, we'll use a simplified version or assume the view handles some of it.
        
        // This is a bit of a shortcut - we're still using global gameState/managers
        const headWorldPos = { x: 0, y: 1.7, z: 0 }; // Placeholder
        const bodyYaw = 0; // Placeholder
        const localHeadQuat = { x: 0, y: 0, z: 0, w: 1 }; // Placeholder

        this.view.applyState({
            position: this.xrOrigin.position, // Simplified
            yaw: bodyYaw,
            headHeight: headWorldPos.y,
            headQuaternion: localHeadQuat,
            handStates: this.handStates,
            name: this.name,
            color: (gameState as any).avatarConfig.color,
            isLocal: true,
            audioLevel: managers.media ? managers.media.getLocalVolume() : 0,
            lerpFactor: 1.0
        }, delta);

        if (Math.pow(this._lastMoveVector.x, 2) + Math.pow(this._lastMoveVector.y, 2) + Math.pow(this._lastMoveVector.z, 2) > 0) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, this.getNetworkState());
        }
    }

    private updateVRHands(): void {
        // Placeholder - this logic uses Three.js XR session
    }

    public getNetworkState(): any {
        // Serialization logic (needs to be carefully implemented without Three.js)
        return {
            id: this.id,
            type: this.type,
            name: this.name,
            position: this.xrOrigin.position,
            yaw: 0, // Placeholder
            headHeight: 1.7,
            head: {
                position: this.headState.position,
                quaternion: this.headState.quaternion
            },
            hands: this.handStates,
            avatarConfig: (gameState as any).avatarConfig
        };
    }

    public applyNetworkState(state: any): void {
        // LocalPlayer is usually authority, but if we need to sync from server:
    }

    public destroy(): void {
        super.destroy();
        for (const skill of this.skills) {
            skill.destroy();
        }
        this.skills = [];
        this.activeSkill = null;

        const render = (gameState as any).managers.render;
        if (render && this.view) {
            (this.view as any).removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
