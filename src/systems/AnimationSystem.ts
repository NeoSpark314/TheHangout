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

        const headPos = new THREE.Vector3();
        const headDir = new THREE.Vector3();
        render.camera.getWorldPosition(headPos);
        render.camera.getWorldDirection(headDir);

        // Update head to local space (RenderManager translates camera relative to xrOrigin)
        const headBobY = this._isMoving ? Math.sin(this._bobTime) * 0.05 : 0;
        this.localPlayer.headState.position = { x: 0, y: this.localPlayer.headHeight + headBobY, z: 0 };

        for (const hand of ['left', 'right'] as const) {
            const state = this.localPlayer.handStates[hand];
            state.active = true;
            state.quaternion = { x: 0, y: 0, z: 0, w: 1 }; // Default Desktop hand rotation

            // Update interaction animation timer
            if (this._interactState[hand]) {
                this._interactTime[hand] = Math.min(1.0, this._interactTime[hand] + delta * 10);
            } else {
                this._interactTime[hand] = Math.max(0.0, this._interactTime[hand] - delta * 5);
            }

            const t = this._interactTime[hand];

            // Calculate Rest Position (Hips area)
            const sideOffset = hand === 'left' ? -0.4 : 0.4;
            const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(render.camera.quaternion);
            const downVector = new THREE.Vector3(0, -1, 0).applyQuaternion(render.camera.quaternion);
            const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(render.camera.quaternion);

            // Bobbing offset
            const bobY = this._isMoving ? Math.sin(this._bobTime + (hand === 'left' ? 0 : Math.PI)) * 0.1 : 0;
            const bobZ = this._isMoving ? Math.cos(this._bobTime + (hand === 'left' ? 0 : Math.PI)) * 0.1 : 0;

            const restPos = headPos.clone()
                .add(downVector.clone().multiplyScalar(0.6)) // down from head
                .add(rightVector.clone().multiplyScalar(sideOffset)) // out to side
                .add(forwardVector.clone().multiplyScalar(0.2 + bobZ)); // slightly forward

            restPos.y += bobY;

            // Calculate Target Position (Reaching out 1.2m)
            const targetPos = headPos.clone().add(headDir.clone().multiplyScalar(1.2));

            // Lerp based on interact time to animate the hand shooting forward
            const finalPos = new THREE.Vector3().lerpVectors(restPos, targetPos, t);

            state.position = { x: finalPos.x, y: finalPos.y, z: finalPos.z };
        }
    }
}
