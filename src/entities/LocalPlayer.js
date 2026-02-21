import * as THREE from 'three';
import { Avatar } from './Avatar.js';
import { PlayerEntity } from './PlayerEntity.js';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class LocalPlayer extends PlayerEntity {
    constructor() {
        super('local-player-id-temp', 'LOCAL_PLAYER', true);

        this.speed = 5.0;
        this.turnSpeed = 0.002;

        // Movement intent
        this.keys = {
            w: false,
            a: false,
            s: false,
            d: false,
        };

        // --- Clean Architecture Transforms ---
        // xrOrigin is the physical center of the room (pinned to y=0)
        this.xrOrigin = new THREE.Object3D();

        // These poses are relative to the xrOrigin
        this.headPose = new THREE.Object3D();
        this.leftHandPose = new THREE.Object3D();
        this.rightHandPose = new THREE.Object3D();

        this.xrOrigin.add(this.headPose);
        this.xrOrigin.add(this.leftHandPose);
        this.xrOrigin.add(this.rightHandPose);

        // Initial Static Offsets (Desktop Simulation)
        this.headPose.position.set(0, 1.7, 0);
        this.leftHandPose.position.set(-0.35, 1.1, -0.4);
        this.rightHandPose.position.set(0.35, 1.1, -0.4);

        // Input angles
        this.pitch = 0;
        this.yaw = 0;

        this.initAvatar();
        this.initInput();
    }

    initAvatar() {
        const { render } = gameState.managers;
        if (!render) return;

        this.avatar = new Avatar({ color: 0x00ffff, isLocal: true });
        this.mesh = this.avatar.mesh;
        render.add(this.mesh);
    }

    initInput() {
        window.addEventListener('keydown', (e) => this.onKeyChange(e.key.toLowerCase(), true));
        window.addEventListener('keyup', (e) => this.onKeyChange(e.key.toLowerCase(), false));

        const canvas = document.getElementById('app');
        canvas.addEventListener('click', () => canvas.requestPointerLock());

        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === canvas) {
                this.yaw -= e.movementX * this.turnSpeed;
                this.pitch -= e.movementY * this.turnSpeed;
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
        if (!render) return;

        // 1. Apply Orientation inputs to our internal hierarchy
        // The xrOrigin represents the physical floor space rotation
        this.xrOrigin.rotation.y = this.yaw;
        // The headPose handles looking up/down
        this.headPose.rotation.x = this.pitch;

        // 2. Handle Locomotion (move the xrOrigin)
        const direction = new THREE.Vector3(0, 0, 0);
        if (this.keys.w) direction.z -= 1;
        if (this.keys.s) direction.z += 1;
        if (this.keys.a) direction.x -= 1;
        if (this.keys.d) direction.x += 1;

        if (direction.lengthSq() > 0) {
            direction.normalize();
            // Move relative to the origin's current yaw
            direction.applyEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
            this.xrOrigin.position.addScaledVector(direction, this.speed * delta);
        }

        // 3. Sync Render Scene (Three.js camera structure)
        // cameraGroup (Dolly) = xrOrigin
        render.cameraGroup.position.copy(this.xrOrigin.position);
        render.cameraGroup.quaternion.copy(this.xrOrigin.quaternion);

        // camera (HMD) = headPose
        render.camera.position.copy(this.headPose.position);
        render.camera.quaternion.copy(this.headPose.quaternion);

        // 4. Update Visual Avatar
        // The avatar feet are at the World X/Z of the active camera
        const headWorldPos = new THREE.Vector3();
        this.headPose.getWorldPosition(headWorldPos);

        // Ground the stick figure at y=0, directly under the head
        this.mesh.position.set(headWorldPos.x, 0, headWorldPos.z);

        // Posture tracking (height change if any)
        this.avatar.updatePosture(headWorldPos.y);

        // Body rotation follows the physical heading (yaw)
        this.mesh.rotation.y = this.yaw;

        // Neck orientation (pitch)
        this.avatar.updateHeadOrientation(this.headPose.quaternion);

        // Arms (static relative to origin for now)
        this.avatar.updateArms(this.leftHandPose.position, this.rightHandPose.position);

        // 5. Network Emission
        if (direction.lengthSq() > 0 || Math.abs(this.yaw) > 0.001) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, this.getNetworkState());
        }
    }

    getNetworkState() {
        // Return representative state for network synchronization
        return {
            position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
            yaw: this.yaw,
            headHeight: this.headPose.position.y,
            head: {
                position: { x: this.headPose.position.x, y: this.headPose.position.y, z: this.headPose.position.z },
                quaternion: { x: this.headPose.quaternion.x, y: this.headPose.quaternion.y, z: this.headPose.quaternion.z, w: this.headPose.quaternion.w }
            },
            hands: {
                left: {
                    active: true,
                    position: { x: this.leftHandPose.position.x, y: this.leftHandPose.position.y, z: this.leftHandPose.position.z },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                },
                right: {
                    active: true,
                    position: { x: this.rightHandPose.position.x, y: this.rightHandPose.position.y, z: this.rightHandPose.position.z },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                }
            }
        };
    }
}
