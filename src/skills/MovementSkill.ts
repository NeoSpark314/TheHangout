import * as THREE from 'three';
import { Skill } from './Skill';
import { PlayerAvatarEntity } from '../world/entities/PlayerAvatarEntity';
import { IVector3 } from '../shared/contracts/IMath';
import type { IRuntimeRegistry } from '../app/AppContext';
import eventBus from '../app/events/EventBus';
import { EVENTS } from '../shared/constants/Constants';
import { IMoveIntentPayload, ILookIntentPayload, IVRSnapTurnPayload } from '../shared/contracts/IIntents';

export class MovementSkill extends Skill {
    public speed: number = 5.0;
    public turnSpeed: number = 0.002;
    public pitch: number = 0;
    public yaw: number = 0;
    private _inputListenersAttached: boolean = false;
    private _wasSnapTurnPressed: boolean = false;
    private _explicitTurnDeltaYaw = 0;

    // Current movement intent state
    private _currentMove: { x: number, y: number } = { x: 0, y: 0 };
    private _handlers: Array<{ event: string, handler: any }> = [];

    constructor() {
        super('movement', 'Movement', { isAlwaysActive: true });
    }

    public setYaw(yaw: number): void {
        this.yaw = yaw;
    }

    public activate(player: PlayerAvatarEntity): void {
        super.activate(player);

        const onMove = (payload: IMoveIntentPayload) => {
            this._currentMove = payload.direction;
        };
        const onLook = (payload: ILookIntentPayload) => {
            if (!player.appContext.runtime.render.isXRPresenting()) return;
            // In XR, look-based turning is explicit origin turning. Desktop simulates a local HMD in the tracking provider.
            this.yaw -= payload.yawDeltaRad;
            this._explicitTurnDeltaYaw -= payload.yawDeltaRad;
        };
        const onVRSnapTurn = (payload: IVRSnapTurnPayload) => {
            this.applyVRTurn(player, payload.angle, player.appContext.runtime);
        };

        eventBus.on(EVENTS.INTENT_MOVE, onMove);
        eventBus.on(EVENTS.INTENT_LOOK, onLook);
        eventBus.on(EVENTS.INTENT_VR_SNAP_TURN, onVRSnapTurn);

        this._handlers.push({ event: EVENTS.INTENT_MOVE, handler: onMove });
        this._handlers.push({ event: EVENTS.INTENT_LOOK, handler: onLook });
        this._handlers.push({ event: EVENTS.INTENT_VR_SNAP_TURN, handler: onVRSnapTurn });
    }

    public deactivate(player: PlayerAvatarEntity): void {
        super.deactivate(player);
        for (const { event, handler } of this._handlers) {
            eventBus.off(event, handler);
        }
        this._handlers = [];
        this._currentMove = { x: 0, y: 0 };
    }

    private _attachInputListeners(player: PlayerAvatarEntity, runtime: IRuntimeRegistry): boolean {
        const canvas =
            (runtime.render?.renderer?.domElement as HTMLElement | undefined) ||
            (document.getElementById('app') as HTMLElement | null) ||
            undefined;
        if (!canvas) return false;

        canvas.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button !== 2) return; // Right click only
            const render = runtime.render;
            if (render && !render.isXRPresenting()) {
                canvas.requestPointerLock();
            }
        });

        return true;
    }

    public update(delta: number, player: PlayerAvatarEntity, runtime: IRuntimeRegistry): void {
        const render = runtime.render;

        if (!this._inputListenersAttached) {
            this._inputListenersAttached = this._attachInputListeners(player, runtime);
        }

        const isVR = render.isXRPresenting();

        // 1. Orientation
        if (!isVR) {
            player.xrOrigin.quaternion = {
                x: 0,
                y: Math.sin(this.yaw / 2),
                z: 0,
                w: Math.cos(this.yaw / 2)
            };
        }

        // 2. Locomotion based on current intent
        const moveVector = new THREE.Vector3(this._currentMove.x, 0, this._currentMove.y);

        if (moveVector.lengthSq() > 0) {
            const moveMagnitude = Math.min(1, moveVector.length());
            if (moveMagnitude > 0) {
                moveVector.divideScalar(moveMagnitude);
            }

            // Head world yaw for direction
            const headWorldQuat = new THREE.Quaternion();
            render.camera.getWorldQuaternion(headWorldQuat);
            const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');

            // Transform local movement to world space relative to head heading
            moveVector.applyEuler(new THREE.Euler(0, headEuler.y, 0, 'YXZ'));
            moveVector.multiplyScalar(moveMagnitude);

            player.xrOrigin.position.x += moveVector.x * this.speed * delta;
            player.xrOrigin.position.y += moveVector.y * this.speed * delta;
            player.xrOrigin.position.z += moveVector.z * this.speed * delta;
        }

        player._lastMoveVector = { x: moveVector.x, y: moveVector.y, z: moveVector.z };
    }

    public consumeExplicitTurnDeltaYaw(): number {
        const deltaYaw = this._explicitTurnDeltaYaw;
        this._explicitTurnDeltaYaw = 0;
        return deltaYaw;
    }

    private applyVRTurn(player: PlayerAvatarEntity, deltaYaw: number, runtime: IRuntimeRegistry): void {
        const render = runtime.render;

        // Pivot around camera world position
        const pivot = new THREE.Vector3();
        render.camera.getWorldPosition(pivot);
        const pivotXZ = new THREE.Vector3(pivot.x, 0, pivot.z);

        const currentPos = new THREE.Vector3(player.xrOrigin.position.x, player.xrOrigin.position.y, player.xrOrigin.position.z);
        currentPos.sub(pivotXZ);
        currentPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), deltaYaw);
        currentPos.add(pivotXZ);

        player.xrOrigin.position = { x: currentPos.x, y: currentPos.y, z: currentPos.z };

        this.yaw += deltaYaw;
        this._explicitTurnDeltaYaw += deltaYaw;
        player.xrOrigin.quaternion = {
            x: 0,
            y: Math.sin(this.yaw / 2),
            z: 0,
            w: Math.cos(this.yaw / 2)
        };
    }
}
