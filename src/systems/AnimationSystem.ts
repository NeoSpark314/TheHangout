import * as THREE from 'three';
import { LocalPlayer } from '../entities/LocalPlayer';
import type { IManagers } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IMoveIntentPayload, IXRHeadTrackedPayload } from '../interfaces/IIntents';
import { IUpdatable } from '../interfaces/IUpdatable';

/**
 * Consumes logical Intents (mainly VR Tracking and Movement) to position the 
 * virtual hands and head of the LocalPlayer. 
 * This unifies Desktop procedural animations with VR 1:1 hardware tracking.
 */
export class AnimationSystem implements IUpdatable {
    private localPlayer: LocalPlayer | null = null;
    private managers: IManagers | null = null;

    private _isVR: boolean = false;
    private _isMoving: boolean = false;
    private _bobTime: number = 0;

    constructor() {
        eventBus.on(EVENTS.INTENT_XR_HEAD_TRACKED, this._onXRHead.bind(this));
        eventBus.on(EVENTS.INTENT_MOVE, this._onMove.bind(this));
    }

    public setLocalPlayer(player: LocalPlayer, managers: IManagers): void {
        this.localPlayer = player;
        this.managers = managers;
    }

    private _onXRHead(payload: IXRHeadTrackedPayload): void {
        this._isVR = true;
        if (!this.localPlayer) return;
        this.localPlayer.headState.position = { x: payload.position.x, y: payload.position.y, z: payload.position.z };
        this.localPlayer.headState.quaternion = { x: payload.quaternion.x, y: payload.quaternion.y, z: payload.quaternion.z, w: payload.quaternion.w };
    }

    private _onMove(payload: IMoveIntentPayload): void {
        this._isMoving = (payload.direction.x !== 0 || payload.direction.y !== 0);
    }

    public update(delta: number): void {
        if (!this.localPlayer || !this.managers) return;
        const render = this.managers.render;

        // If VR is active, XR tracking provider already owns hand state updates.
        if (render.isXRPresenting()) {
            this._isVR = true;
            return;
        }

        this._isVR = false;

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
