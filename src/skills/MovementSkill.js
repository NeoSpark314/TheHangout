// skills/MovementSkill.js

import * as THREE from 'three';
import { Skill } from './Skill.js';
import gameState from '../core/GameState.js';

/**
 * Handles all player locomotion: keyboard, mobile joystick, gamepad, VR thumbsticks,
 * mouse look, mobile look stick, and VR snap-turn.
 * 
 * Operates on the player's xrOrigin and headPose transforms.
 * Always active — cannot be deactivated.
 */
export class MovementSkill extends Skill {
    constructor() {
        super('movement', 'Movement', { alwaysActive: true });

        this.speed = 5.0;
        this.turnSpeed = 0.002;

        // Input angles (owned by this skill, applied to player's headPose/xrOrigin)
        this.pitch = 0;
        this.yaw = 0;

        this.wasSnapTurnPressed = false;
        this._inputListenersAttached = false;
    }

    activate(player) {
        super.activate(player);

        if (!this._inputListenersAttached) {
            this._attachInputListeners(player);
            this._inputListenersAttached = true;
        }
    }

    /**
     * Initialize with spawn yaw and attach DOM input listeners.
     */
    init(player, spawnYaw) {
        this.yaw = spawnYaw || 0;
        this.pitch = 0;
        this._attachInputListeners(player);
    }

    _attachInputListeners(player) {
        const canvas = document.getElementById('app');

        this._onCanvasClick = () => {
            const { render } = gameState.managers;
            const isVR = render?.renderer?.xr?.isPresenting;
            if (!isVR) canvas.requestPointerLock();
        };

        this._onMouseMove = (e) => {
            const { render } = gameState.managers;
            const isVR = render?.renderer?.xr?.isPresenting;

            if (document.pointerLockElement === canvas && !isVR) {
                this.applyTurn(player, -e.movementX * this.turnSpeed);
                this.pitch -= e.movementY * this.turnSpeed;
                this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            }
        };

        canvas.addEventListener('click', this._onCanvasClick);
        document.addEventListener('mousemove', this._onMouseMove);
        this._inputListenersAttached = true;
    }

    update(delta, player) {
        const { render } = gameState.managers;
        if (!render) return;

        const isVR = render.renderer.xr.isPresenting;

        // --- 1. ORIENTATION (Pitch Only) ---
        if (!isVR) {
            player.headPose.rotation.x = this.pitch;
        } else {
            // Capture physical height and pitch from VR camera
            player.headPose.position.copy(render.camera.position);
            const headEuler = new THREE.Euler().setFromQuaternion(render.camera.quaternion, 'YXZ');
            this.pitch = headEuler.x;
        }

        // --- 2. SYNC RENDERER TRANSFORMS ---
        render.cameraGroup.position.copy(player.xrOrigin.position);
        render.cameraGroup.quaternion.copy(player.xrOrigin.quaternion);

        if (!isVR) {
            render.camera.position.copy(player.headPose.position);
            render.camera.quaternion.copy(player.headPose.quaternion);
        }

        render.cameraGroup.updateMatrixWorld(true);

        // --- 3. LOCOMOTION ---
        const moveVector = new THREE.Vector3(0, 0, 0);

        // 3a. Combined Inputs (Keyboard + Mobile Stick) via InputManager
        const input = gameState.managers.input;
        if (input) {
            const move = input.getMovementVector();
            moveVector.x = move.x;
            moveVector.z = move.y; // Forward/Back is Z

            // 3b. Mobile Look Stick
            const look = input.getLookVector();
            if (look.x !== 0 || look.y !== 0) {
                this.applyTurn(player, -look.x * this.turnSpeed * 15);
                this.pitch -= look.y * this.turnSpeed * 15;
                this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            }
        }

        // 3c. VR Joysticks
        this.updateVRLocomotion(player, moveVector);

        if (moveVector.lengthSq() > 0) {
            moveVector.normalize();

            const headWorldQuat = new THREE.Quaternion();
            render.camera.getWorldQuaternion(headWorldQuat);
            const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');

            moveVector.applyEuler(new THREE.Euler(0, headEuler.y, 0, 'YXZ'));
            player.xrOrigin.position.addScaledVector(moveVector, this.speed * delta);

            render.cameraGroup.position.copy(player.xrOrigin.position);
            render.cameraGroup.updateMatrixWorld(true);
        }

        // Store moveVector on player so it can check if movement happened (for network)
        player._lastMoveVector = moveVector;
    }

    updateVRLocomotion(player, moveVector) {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.isPresenting) return;

        const session = render.renderer.xr.getSession();
        if (!session) return;

        for (const source of session.inputSources) {
            if (source.gamepad) {
                const axes = source.gamepad.axes;

                if (source.handedness === 'left') {
                    const xIdx = axes.length >= 4 ? 2 : 0;
                    const zIdx = axes.length >= 4 ? 3 : 1;
                    const dx = axes[xIdx] || 0;
                    const dz = axes[zIdx] || 0;

                    if (Math.abs(dx) > 0.1) moveVector.x += dx;
                    if (Math.abs(dz) > 0.1) moveVector.z += dz;
                }

                if (source.handedness === 'right') {
                    const xIdx = axes.length >= 4 ? 2 : 0;
                    if (axes.length > xIdx && Math.abs(axes[xIdx]) > 0.5) {
                        if (!this.wasSnapTurnPressed) {
                            const sign = Math.sign(axes[xIdx]);
                            const turnAngle = sign * (-Math.PI / 4);
                            this.applyTurn(player, turnAngle);
                            this.wasSnapTurnPressed = true;
                            this.triggerHaptic(0.5, 100);
                        }
                    } else {
                        this.wasSnapTurnPressed = false;
                    }
                }
            }
        }
    }

    applyTurn(player, deltaYaw) {
        const { render } = gameState.managers;
        if (!render) return;

        const pivot = new THREE.Vector3();
        render.camera.getWorldPosition(pivot);
        const pivotXZ = new THREE.Vector3(pivot.x, 0, pivot.z);

        player.xrOrigin.position.sub(pivotXZ);
        player.xrOrigin.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), deltaYaw);
        player.xrOrigin.position.add(pivotXZ);

        this.yaw += deltaYaw;
        player.xrOrigin.rotation.y = this.yaw;
    }

    triggerHaptic(intensity, duration) {
        const { render } = gameState.managers;
        const session = render?.renderer?.xr?.getSession();
        if (!session) return;

        for (const source of session.inputSources) {
            if (source.gamepad && source.gamepad.hapticActuators && source.gamepad.hapticActuators.length > 0) {
                source.gamepad.hapticActuators[0].pulse(intensity, duration);
            }
        }
    }

    destroy() {
        const canvas = document.getElementById('app');
        if (this._onCanvasClick) canvas?.removeEventListener('click', this._onCanvasClick);
        if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
    }
}
