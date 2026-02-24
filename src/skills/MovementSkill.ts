import * as THREE from 'three';
import { Skill } from './Skill';
import { LocalPlayer } from '../entities/LocalPlayer';
import { Vector3 } from '../interfaces/IMath';
import gameState from '../core/GameState';

export class MovementSkill extends Skill {
    public speed: number = 5.0;
    public turnSpeed: number = 0.002;
    public pitch: number = 0;
    public yaw: number = 0;
    private _inputListenersAttached: boolean = false;
    private _wasSnapTurnPressed: boolean = false;

    constructor() {
        super('movement', 'Movement', { alwaysActive: true });
    }

    public setYaw(yaw: number): void {
        this.yaw = yaw;
    }

    public activate(player: LocalPlayer): void {
        super.activate(player);
        if (!this._inputListenersAttached) {
            this._attachInputListeners(player);
            this._inputListenersAttached = true;
        }
    }

    private _attachInputListeners(player: LocalPlayer): void {
        const canvas = document.getElementById('app');
        if (!canvas) return;

        canvas.addEventListener('click', () => {
            const render = gameState.managers.render;
            if (render && !render.isXRPresenting()) {
                canvas.requestPointerLock();
            }
        });

        document.addEventListener('mousemove', (e) => {
            const render = gameState.managers.render;
            if (document.pointerLockElement === canvas && render && !render.isXRPresenting()) {
                this.yaw -= e.movementX * this.turnSpeed;
                this.pitch -= e.movementY * this.turnSpeed;
                this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            }
        });
    }

    public update(delta: number, player: LocalPlayer): void {
        const managers = gameState.managers;
        const render = managers.render;
        const input = managers.input;

        const isVR = render.isXRPresenting();

        // 1. Orientation
        if (!isVR) {
            // Apply look vector (Mobile Joystick / Gamepad)
            const look = input.getLookVector();
            if (look.x !== 0 || look.y !== 0) {
                // Multiplier to match mouse sensitivity feel
                this.yaw -= look.x * this.turnSpeed * 15;
                this.pitch -= look.y * this.turnSpeed * 15;
                this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            }

            player.headPose.quaternion = {
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
        } else {
            // VR Snap Turn
            if (Math.abs(input.xrTurn) > 0.5) {
                if (!this._wasSnapTurnPressed) {
                    const sign = Math.sign(input.xrTurn);
                    const turnAngle = sign * (-Math.PI / 4);
                    this.applyVRTurn(player, turnAngle);
                    this._wasSnapTurnPressed = true;
                }
            } else {
                this._wasSnapTurnPressed = false;
            }
        }

        // 2. Locomotion
        const move = input.getMovementVector();
        const moveVector = new THREE.Vector3(move.x, 0, move.y);

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

    private applyVRTurn(player: LocalPlayer, deltaYaw: number): void {
        const render = gameState.managers.render;
        if (!render) return;

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
