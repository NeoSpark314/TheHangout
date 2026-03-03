import * as THREE from 'three';
import { LocalPlayer } from '../../world/entities/LocalPlayer';
import type { IManagers } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { IMoveIntentPayload } from '../../shared/contracts/IIntents';
import { IUpdatable } from '../../shared/contracts/IUpdatable';

/**
 * Consumes logical Intents (mainly VR Tracking and Movement) to position the 
 * virtual hands and head of the LocalPlayer. 
 * This unifies Desktop procedural animations with VR 1:1 hardware tracking.
 */
export class AnimationSystem implements IUpdatable {
    private localPlayer: LocalPlayer | null = null;
    private managers: IManagers | null = null;

    private _isMoving: boolean = false;
    private _bobTime: number = 0;

    constructor() {
        eventBus.on(EVENTS.INTENT_MOVE, this._onMove.bind(this));
    }

    public setLocalPlayer(player: LocalPlayer, managers: IManagers): void {
        this.localPlayer = player;
        this.managers = managers;
    }

    private _onMove(payload: IMoveIntentPayload): void {
        this._isMoving = (payload.direction.x !== 0 || payload.direction.y !== 0);
    }

    public update(delta: number): void {
        if (!this.localPlayer || !this.managers) return;
        const render = this.managers.render;

        // If VR is active, XR tracking provider already owns hand state updates.
        if (render.isXRPresenting()) {
            return;
        }

        // Desktop / Mobile Procedural Animation
        this._bobTime += this._isMoving ? delta * 15 : 0;

        const originPos = new THREE.Vector3(this.localPlayer.xrOrigin.position.x, this.localPlayer.xrOrigin.position.y, this.localPlayer.xrOrigin.position.z);
        const originQuat = new THREE.Quaternion(this.localPlayer.xrOrigin.quaternion.x, this.localPlayer.xrOrigin.quaternion.y, this.localPlayer.xrOrigin.quaternion.z, this.localPlayer.xrOrigin.quaternion.w);

        // 1. Update Head State (World Space)
        const headBobY = this._isMoving ? Math.sin(this._bobTime) * 0.05 : 0;
        const headLocalPos = new THREE.Vector3(0, (this.localPlayer as any).headHeight + headBobY, 0);
        const worldHeadPos = headLocalPos.clone().applyQuaternion(originQuat).add(originPos);

        this.localPlayer.headState.position = { x: worldHeadPos.x, y: worldHeadPos.y, z: worldHeadPos.z };
        // Note: Head quaternion is already synced to camera by RenderManager/TrackingProvider on Desktop
    }
}
