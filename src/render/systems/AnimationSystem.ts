import * as THREE from 'three';
import { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';
import type { IRuntimeRegistry } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';

/**
 * Consumes logical Intents (mainly VR Tracking and Movement) to position the 
 * virtual hands and head of the locally controlled player avatar. 
 * This unifies Desktop procedural animations with VR 1:1 hardware tracking.
 */
export class AnimationSystem implements IUpdatable {
    private localPlayer: PlayerAvatarEntity | null = null;
    private runtime: IRuntimeRegistry | null = null;

    private _bobTime: number = 0;
    private _smoothedMoveSpeed = 0;

    constructor() { }

    public setLocalPlayer(player: PlayerAvatarEntity, runtime: IRuntimeRegistry): void {
        this.localPlayer = player;
        this.runtime = runtime;
    }

    public clearLocalPlayer(): void {
        this.localPlayer = null;
        this.runtime = null;
        this._bobTime = 0;
        this._smoothedMoveSpeed = 0;
    }

    public update(delta: number): void {
        if (!this.localPlayer || !this.runtime) return;
        const render = this.runtime.render;

        // If VR is active, XR tracking provider already owns hand state updates.
        if (render.isXRPresenting()) {
            return;
        }

        // Desktop / Mobile Procedural Animation driven by actual movement speed.
        const move = this.localPlayer._lastMoveVector;
        const moveSpeed = Math.min(1, Math.sqrt(move.x * move.x + move.z * move.z));
        const smoothing = 10;
        this._smoothedMoveSpeed = THREE.MathUtils.damp(this._smoothedMoveSpeed, moveSpeed, smoothing, delta);
        this._bobTime += delta * (4 + this._smoothedMoveSpeed * 9);

        const headPose = this.localPlayer.getAvatarHeadWorldPose();
        if (!headPose) return;
        const bobAmplitude = 0.06 * this._smoothedMoveSpeed;
        const headBobY = Math.sin(this._bobTime) * bobAmplitude;
        this.localPlayer.setAvatarJointWorldPose('head', {
            position: {
                x: headPose.position.x,
                y: headPose.position.y + headBobY,
                z: headPose.position.z
            },
            quaternion: headPose.quaternion
        }, true);
    }
}
