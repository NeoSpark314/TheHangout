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
        const material = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8); // radius: 0.5, length: 1 -> total height: 2
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
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

        // 1. Calculate intent direction based on yaw
        const direction = new THREE.Vector3(0, 0, 0);

        if (this.keys.w) direction.z -= 1;
        if (this.keys.s) direction.z += 1;
        if (this.keys.a) direction.x -= 1;
        if (this.keys.d) direction.x += 1;

        direction.normalize();

        // Rotate the input direction by our yaw (looking angle)
        const euler = new THREE.Euler(0, this.yaw, 0, 'YXZ');
        direction.applyEuler(euler);

        // 2. Apply movement forces/velocity to physics body
        // We only mutate X and Z velocity to allow gravity to govern Y
        const currentVel = this.rigidBody.linvel();
        this.rigidBody.setLinvel({
            x: direction.x * this.speed,
            y: currentVel.y,
            z: direction.z * this.speed
        }, true);

        // 3. Update Camera Position attached to Player
        const pos = this.rigidBody.translation();

        // Camera is slightly offset towards the top of the capsule
        render.camera.position.set(pos.x, pos.y + 0.8, pos.z);

        // Apply pitch and yaw to camera
        render.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // 4. Emit event if we moved significantly (can optimize this later)
        if (direction.lengthSq() > 0) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, {
                position: pos,
                rotation: { pitch: this.pitch, yaw: this.yaw }
            });
        }
    }
}
