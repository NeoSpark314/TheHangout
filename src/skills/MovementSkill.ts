import * as THREE from 'three';
import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { IVector3 } from '../interfaces/IMath';
import type { IManagers } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IMoveIntentPayload, ILookIntentPayload, IVRSnapTurnPayload } from '../interfaces/IIntents';

export class MovementSkill extends Skill {
    public speed: number = 5.0;
    public turnSpeed: number = 0.002;
    public pitch: number = 0;
    public yaw: number = 0;
    private _inputListenersAttached: boolean = false;
    private _wasSnapTurnPressed: boolean = false;

    // Current movement intent state
    private _currentMove: { x: number, y: number } = { x: 0, y: 0 };
    private _handlers: Array<{ event: string, handler: any }> = [];

    constructor() {
        super('movement', 'Movement', { isAlwaysActive: true });
    }

    public setYaw(yaw: number): void {
        this.yaw = yaw;
    }

    public activate(player: LocalPlayer): void {
        super.activate(player);

        const onMove = (payload: IMoveIntentPayload) => {
            this._currentMove = payload.direction;
        };
        const onLook = (payload: ILookIntentPayload) => {
            this.yaw -= payload.delta.x * this.turnSpeed * 15;
            this.pitch -= payload.delta.y * this.turnSpeed * 15;
            this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
        };
        const onVRSnapTurn = (payload: IVRSnapTurnPayload) => {
            this.applyVRTurn(player, payload.angle, player.context.managers);
        };

        eventBus.on(EVENTS.INTENT_MOVE, onMove);
        eventBus.on(EVENTS.INTENT_LOOK, onLook);
        eventBus.on(EVENTS.INTENT_VR_SNAP_TURN, onVRSnapTurn);

        this._handlers.push({ event: EVENTS.INTENT_MOVE, handler: onMove });
        this._handlers.push({ event: EVENTS.INTENT_LOOK, handler: onLook });
        this._handlers.push({ event: EVENTS.INTENT_VR_SNAP_TURN, handler: onVRSnapTurn });
    }

    public deactivate(player: LocalPlayer): void {
        super.deactivate(player);
        for (const { event, handler } of this._handlers) {
            eventBus.off(event, handler);
        }
        this._handlers = [];
        this._currentMove = { x: 0, y: 0 };
    }

    private _attachInputListeners(player: LocalPlayer, managers: IManagers): void {
        const canvas = document.getElementById('app');
        if (!canvas) return;

        canvas.addEventListener('click', () => {
            const render = managers.render;
            if (render && !render.isXRPresenting()) {
                canvas.requestPointerLock();
            }
        });
    }

    public update(delta: number, player: LocalPlayer, managers: IManagers): void {
        const render = managers.render;

        if (!this._inputListenersAttached) {
            this._attachInputListeners(player, managers);
            this._inputListenersAttached = true;
        }

        const isVR = render.isXRPresenting();

        // 1. Orientation
        if (!isVR) {
            player.headState.quaternion = {
                x: Math.sin(this.pitch / 2),
                y: 0,
                z: 0,
                w: Math.cos(this.pitch / 2)
            };
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
            moveVector.normalize();

            // Head world yaw for direction
            const headWorldQuat = new THREE.Quaternion();
            render.camera.getWorldQuaternion(headWorldQuat);
            const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');

            // Transform local movement to world space relative to head heading
            moveVector.applyEuler(new THREE.Euler(0, headEuler.y, 0, 'YXZ'));

            player.xrOrigin.position.x += moveVector.x * this.speed * delta;
            player.xrOrigin.position.y += moveVector.y * this.speed * delta;
            player.xrOrigin.position.z += moveVector.z * this.speed * delta;
        }

        player._lastMoveVector = { x: moveVector.x, y: moveVector.y, z: moveVector.z };
    }

    private applyVRTurn(player: LocalPlayer, deltaYaw: number, managers: IManagers): void {
        const render = managers.render;

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
        player.xrOrigin.quaternion = {
            x: 0,
            y: Math.sin(this.yaw / 2),
            z: 0,
            w: Math.cos(this.yaw / 2)
        };
    }
}
