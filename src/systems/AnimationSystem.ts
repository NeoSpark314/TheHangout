import * as THREE from 'three';
import { LocalPlayer } from '../entities/LocalPlayer';
import type { IManagers } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IMoveIntentPayload, IXRHandTrackedPayload, IXRHeadTrackedPayload, IHandIntentPayload } from '../interfaces/IIntents';
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

    // Desktop interaction state
    private _interactState = { left: false, right: false };
    private _interactTime = { left: 0, right: 0 };

    constructor() {
        eventBus.on(EVENTS.INTENT_XR_HAND_TRACKED, this._onXRHand.bind(this));
        eventBus.on(EVENTS.INTENT_XR_HEAD_TRACKED, this._onXRHead.bind(this));
        eventBus.on(EVENTS.INTENT_MOVE, this._onMove.bind(this));

        eventBus.on(EVENTS.INTENT_INTERACT_START, (p: IHandIntentPayload) => this._interactState[p.hand] = true);
        eventBus.on(EVENTS.INTENT_INTERACT_END, (p: IHandIntentPayload) => this._interactState[p.hand] = false);
        eventBus.on(EVENTS.INTENT_GRAB_START, (p: IHandIntentPayload) => this._interactState[p.hand] = true);
        eventBus.on(EVENTS.INTENT_GRAB_END, (p: IHandIntentPayload) => this._interactState[p.hand] = false);
    }

    public setLocalPlayer(player: LocalPlayer, managers: IManagers): void {
        this.localPlayer = player;
        this.managers = managers;
    }

    private _onXRHand(payload: IXRHandTrackedPayload): void {
        this._isVR = true;
        if (!this.localPlayer) return;
        const hand = this.localPlayer.handStates[payload.hand];
        hand.active = true;
        hand.position = { x: payload.position.x, y: payload.position.y, z: payload.position.z };
        hand.quaternion = { x: payload.quaternion.x, y: payload.quaternion.y, z: payload.quaternion.z, w: payload.quaternion.w };
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

        // If VR is active, the XR tracks already populate handStates. We do nothing else.
        if (render.isXRPresenting()) {
            this._isVR = true;
            return;
        }

        this._isVR = false;

        // Desktop / Mobile Procedural Animation
        this._bobTime += this._isMoving ? delta * 15 : 0;

        // Local orientations
        const headLocalRot = render.camera.quaternion.clone();
        const originPos = new THREE.Vector3(this.localPlayer.xrOrigin.position.x, this.localPlayer.xrOrigin.position.y, this.localPlayer.xrOrigin.position.z);
        const originQuat = new THREE.Quaternion(this.localPlayer.xrOrigin.quaternion.x, this.localPlayer.xrOrigin.quaternion.y, this.localPlayer.xrOrigin.quaternion.z, this.localPlayer.xrOrigin.quaternion.w);

        // 1. Update Head State (World Space)
        const headBobY = this._isMoving ? Math.sin(this._bobTime) * 0.05 : 0;
        const headLocalPos = new THREE.Vector3(0, (this.localPlayer as any).headHeight + headBobY, 0);
        const worldHeadPos = headLocalPos.clone().applyQuaternion(originQuat).add(originPos);

        this.localPlayer.headState.position = { x: worldHeadPos.x, y: worldHeadPos.y, z: worldHeadPos.z };
        // Note: Head quaternion is already synced to camera by RenderManager/TrackingProvider on Desktop

        // 2. Update Hand States (World Space)
        for (const hand of ['left', 'right'] as const) {
            const state = this.localPlayer.handStates[hand];

            // On desktop, the DesktopTrackingProvider is now the source of truth for 
            // the hand's base pose and reach. We no longer force state.active = true 
            // here, nor do we procedurally lerp them forward on interaction.
            // This prevents conflicts with the manual scroll reach adjustment.

            // HOWEVER, we still need to update the interaction animation timer 
            // so that hand visuals (fingers) can react to Click/E.
            if (this._interactState[hand]) {
                this._interactTime[hand] = Math.min(1.0, this._interactTime[hand] + delta * 15);
            } else {
                this._interactTime[hand] = Math.max(0.0, this._interactTime[hand] - delta * 8);
            }

            // ADDITIVE INTERACTION FEEDBACK:
            // Apply a small forward "twitch" based on interaction time 
            // This provides visual feedback for Click/E without snapping the arm distance.
            const t = this._interactTime[hand];
            if (t > 0) {
                const headLocalRot = render.camera.quaternion.clone();
                const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(headLocalRot);
                const punchOffset = forwardVector.multiplyScalar(t * 0.1); // Max 10cm punch

                const originQuat = new THREE.Quaternion(this.localPlayer.xrOrigin.quaternion.x, this.localPlayer.xrOrigin.quaternion.y, this.localPlayer.xrOrigin.quaternion.z, this.localPlayer.xrOrigin.quaternion.w);
                const worldPunch = punchOffset.applyQuaternion(originQuat);

                state.position.x += worldPunch.x;
                state.position.y += worldPunch.y;
                state.position.z += worldPunch.z;
            }
        }
    }
}
