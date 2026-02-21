// entities/LocalPlayer.js
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class LocalPlayer {
    constructor() {
        this.speed = 5.0;
        this.turnSpeed = 0.002;

        // Movement intent
        this.keys = {
            w: false,
            a: false,
            s: false,
            d: false,
        };

        // Camera lookup angles
        this.pitch = 0;
        this.yaw = 0;

        this.initAvatar();
        this.initInput();
    }

    initAvatar() {
        const { render, physics } = gameState.managers;
        if (!render || !physics) return;

        // 1. Visible Avatar (Capsule)
        // Solid dark capsule with Neon Cyan edges
        const material = new THREE.MeshBasicMaterial({ color: 0x050510 });
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8); // radius: 0.5, length: 1 -> total height: 2
        this.mesh = new THREE.Mesh(geometry, material);

        // Add neon outline
        const edges = new THREE.EdgesGeometry(geometry);
        const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff });
        const outline = new THREE.LineSegments(edges, outlineMaterial);
        this.mesh.add(outline);

        render.add(this.mesh);

        // 2. Physics Body
        const startPos = { x: 0, y: 5, z: 0 };

        // Create Kinematic or Dynamic body
        // For a player, a dynamic capsule or character controller is better.
        // For this prototype, we'll use a dynamic rigid body with locked rotations (upright).
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(startPos.x, startPos.y, startPos.z)
            .lockRotations();

        this.rigidBody = physics.world.createRigidBody(rigidBodyDesc);

        // Capsule height in Rapier is half-height of the cylindrical part
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.5);
        physics.world.createCollider(colliderDesc, this.rigidBody);

        // Register mesh sync manually since we handle it specifically for camera
        physics.dynamicBodies.push({
            mesh: this.mesh,
            rigidBody: this.rigidBody
        });
    }

    initInput() {
        window.addEventListener('keydown', (e) => this.onKeyChange(e.key.toLowerCase(), true));
        window.addEventListener('keyup', (e) => this.onKeyChange(e.key.toLowerCase(), false));

        const canvas = document.getElementById('app');

        // Pointer Lock for mouse look
        canvas.addEventListener('click', () => {
            canvas.requestPointerLock();
        });

        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === canvas) {
                this.yaw -= e.movementX * this.turnSpeed;
                this.pitch -= e.movementY * this.turnSpeed;

                // Clamp pitch to avoid flipping
                this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            }
        });
    }

    onKeyChange(key, isDown) {
        if (this.keys.hasOwnProperty(key)) {
            this.keys[key] = isDown;
        }
    }

    update(delta) {
        const { render } = gameState.managers;
        if (!render || !this.rigidBody) return;

        // 1. Calculate intent direction
        const direction = new THREE.Vector3(0, 0, 0);

        // Keyboard Input
        if (this.keys.w) direction.z -= 1;
        if (this.keys.s) direction.z += 1;
        if (this.keys.a) direction.x -= 1;
        if (this.keys.d) direction.x += 1;

        // XR Controller Input
        this.updateXRInput(direction);

        direction.normalize();

        // Rotate the movement direction by our current yaw
        // In VR, this yaw might be influenced by the HMD later, but for now we use this.yaw
        const euler = new THREE.Euler(0, this.yaw, 0, 'YXZ');
        direction.applyEuler(euler);

        // 2. Apply movement forces/velocity to physics body
        const currentVel = this.rigidBody.linvel();
        this.rigidBody.setLinvel({
            x: direction.x * this.speed,
            y: currentVel.y,
            z: direction.z * this.speed
        }, true);

        // 3. Update Camera Position attached to Player
        const pos = this.rigidBody.translation();

        // Camera rig is slightly offset towards the top of the capsule
        render.cameraGroup.position.set(pos.x, pos.y + 0.8, pos.z);

        // Apply pitch and yaw to camera group (Third person/Desktop)
        // In XR, the camera itself will have its rotation overridden by the HMD
        render.cameraGroup.rotation.set(0, this.yaw, 0, 'YXZ');
        render.camera.rotation.set(this.pitch, 0, 0, 'YXZ');

        // 4. Emit event if we moved significantly
        if (direction.lengthSq() > 0) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, {
                position: pos,
                rotation: { pitch: this.pitch, yaw: this.yaw }
            });
        }
    }

    updateXRInput(direction) {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.enabled) return;

        const session = render.renderer.xr.getSession();
        if (!session) return;

        // Poll XR Input Sources (Controllers)
        for (const source of session.inputSources) {
            if (!source.gamepad) continue;

            const axes = source.gamepad.axes; // [thumbstickX, thumbstickY, ...]
            const buttons = source.gamepad.buttons;

            // Left Hand: Movement (Standard Mapping)
            if (source.handedness === 'left' && axes.length >= 4) {
                // axes[2] is X, axes[3] is Y for thumbstick
                direction.x += axes[2] || 0;
                direction.z += axes[3] || 0;
            }

            // Right Hand: Rotation / Jump
            if (source.handedness === 'right') {
                // Snap Turn (Simple version)
                if (axes.length >= 4 && Math.abs(axes[2]) > 0.5) {
                    // This is a bit sensitive without a debounce, but fine for prototype
                    this.yaw -= axes[2] * 0.05;
                }

                // Jump (Button 0 is usually Trigger/A)
                if (buttons[0].pressed && !this.wasJumpPressed) {
                    this.jump();
                    this.wasJumpPressed = true;
                } else if (!buttons[0].pressed) {
                    this.wasJumpPressed = false;
                }
            }
        }
    }

    jump() {
        if (!this.rigidBody) return;

        // Simple vertical impulse
        // In a real game, you'd check if grounded, but for this synthwave world we'll allow air-hops or single jump
        const currentVel = this.rigidBody.linvel();

        // Simple "is near floor" check by position.y
        const pos = this.rigidBody.translation();
        if (pos.y < 1.2) { // 1.1 is roughly standing on floor (0.1) with 1.0 half-height
            this.rigidBody.setLinvel({
                x: currentVel.x,
                y: 5.0, // Jump force
                z: currentVel.z
            }, true);

            // Haptic Pulse if in VR
            this.triggerHaptic(0.5, 100);
        }
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
}
