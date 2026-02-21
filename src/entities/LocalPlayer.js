import * as THREE from 'three';
import { Avatar } from './Avatar.js';
import { PlayerEntity } from './PlayerEntity.js';
import RAPIER from '@dimforge/rapier3d-compat';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class LocalPlayer extends PlayerEntity {
    constructor() {
        super('local-player-id-temp', 'LOCAL_PLAYER', true); // Temporarily true, id should be assigned by NetworkManager ultimately

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

        this.roomScaleOffset = new THREE.Vector3(0, 0, 0); // Offset between physics body and virtual origin

        this.initAvatar();
        this.initInput();
    }

    initAvatar() {
        const { render, physics } = gameState.managers;
        if (!render || !physics) return;

        // Instantiate unified Avatar entity, marked as local implicitly or explicitly
        this.avatar = new Avatar({ color: 0x00ffff, isLocal: true });
        this.mesh = this.avatar.mesh; // Expose the root group for existing code that uses this.mesh

        render.add(this.mesh);

        // --- Physics Body ---
        const startPos = { x: 0, y: 5, z: 0 };

        // Keep dynamic capsule for physical interaction/collisions
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(startPos.x, startPos.y, startPos.z)
            .lockRotations();

        this.rigidBody = physics.world.createRigidBody(rigidBodyDesc);

        // Height is 1.8 total (-0.9 to 0.9 local)
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.6, 0.3); // half-height 0.6 + radius 0.3 = 0.9
        physics.world.createCollider(colliderDesc, this.rigidBody);
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
            const isXR = gameState.managers.render?.renderer?.xr?.isPresenting;
            if (document.pointerLockElement === canvas && !isXR) {
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
        if (this.keys.w) direction.z -= 1; // Forward is -Z
        if (this.keys.s) direction.z += 1;
        if (this.keys.a) direction.x -= 1;
        if (this.keys.d) direction.x += 1;

        // XR Locomotion Update
        this.updateXRLocomotion(direction);

        direction.normalize();

        const isXR = render.renderer.xr.enabled && render.renderer.xr.isPresenting;

        // Rotate the movement direction by active yaw (HMD in VR, mouse in Desktop)
        const activeYaw = isXR ? (this.worldYaw !== undefined ? this.worldYaw : this.yaw) : this.yaw;
        const euler = new THREE.Euler(0, activeYaw, 0, 'YXZ');
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

        // Base ground level for capsule
        const groundY = pos.y - 0.9;

        if (isXR) {
            // Anchor play space center exactly on capsule
            render.cameraGroup.position.set(pos.x, groundY, pos.z);

            // Sync avatar mesh to TRUE headset offset so it follows bodily physical steps
            const xrCamera = render.renderer.xr.getCamera(render.camera);
            const hmdWorldPos = new THREE.Vector3();
            xrCamera.getWorldPosition(hmdWorldPos);
            this.mesh.position.set(hmdWorldPos.x, groundY, hmdWorldPos.z);
        } else {
            render.cameraGroup.position.set(pos.x, groundY + 1.7, pos.z);
            this.mesh.position.set(pos.x, groundY, pos.z);
        }

        // Apply pitch and yaw to camera group (Third person/Desktop)
        render.cameraGroup.rotation.set(0, this.yaw, 0, 'YXZ');
        render.camera.rotation.set(this.pitch, 0, 0, 'YXZ');

        // --- Room Scale Follow ---
        if (render.renderer.xr.enabled && render.renderer.xr.isPresenting) {
            const xrCamera = render.renderer.xr.getCamera(render.camera);
            const hmdWorldPos = new THREE.Vector3();
            xrCamera.getWorldPosition(hmdWorldPos);

            // The capsule should move to the headset's horizontal world position
            const deltaX = hmdWorldPos.x - pos.x;
            const deltaZ = hmdWorldPos.z - pos.z;

            if (Math.abs(deltaX) > 0.01 || Math.abs(deltaZ) > 0.01) {
                // Move physics body to HMD
                this.rigidBody.setTranslation({ x: hmdWorldPos.x, y: pos.y, z: hmdWorldPos.z }, true);

                // Track how much we moved the body relative to the virtual origin
                this.roomScaleOffset.x += deltaX;
                this.roomScaleOffset.z += deltaZ;
            }
        }

        // Update dynamic headset height to adjust avatar scaling
        const cameraWorldPos = new THREE.Vector3();
        if (isXR) {
            const xrCamera = render.renderer.xr.getCamera(render.camera);
            xrCamera.getWorldPosition(cameraWorldPos);
        } else {
            render.camera.getWorldPosition(cameraWorldPos);
        }

        const playerWorldPos = new THREE.Vector3();
        this.mesh.getWorldPosition(playerWorldPos);

        // Height of head above the player's ground plane
        this.headHeight = Math.max(0.4, cameraWorldPos.y - playerWorldPos.y);

        this.avatar.updatePosture(this.headHeight);

        // Update Local Head Mesh to match camera orientation for others to see
        if (render.renderer.xr.enabled && render.renderer.xr.isPresenting) {
            const xrCamera = render.renderer.xr.getCamera(render.camera);
            const hmdWorldQuat = new THREE.Quaternion();
            xrCamera.getWorldQuaternion(hmdWorldQuat);

            // 1. Update the stick figure body FIRST to follow the HMD's yaw
            const hmdEuler = new THREE.Euler().setFromQuaternion(hmdWorldQuat, 'YXZ');
            this.mesh.rotation.y = hmdEuler.y;
            this.worldYaw = hmdEuler.y;

            this.mesh.updateMatrixWorld(true);

            // 2. Calculate head rotation RELATIVE to the newly rotated body
            const playerWorldQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hmdEuler.y, 0, 'YXZ'));

            const localHeadQuat = playerWorldQuat.invert().multiply(hmdWorldQuat);
            this.avatar.updateHeadOrientation(localHeadQuat);
        } else {
            // In Desktop, head just follows pitch (yaw is handled by body)
            this.worldYaw = this.yaw;
            this.mesh.rotation.y = this.worldYaw;
            this.mesh.updateMatrixWorld(true);
            this.avatar.updateHeadRotation(new THREE.Euler(this.pitch, 0, 0, 'YXZ'));
        }

        // --- Update XR Avatar Visuals (Hands/Arms) AFTER mesh/body rotation is finalized ---
        this.updateXRAvatarState();

        // 4. Emit event if we moved significantly
        if (direction.lengthSq() > 0) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, {
                position: pos,
                rotation: { pitch: this.pitch, yaw: this.yaw }
            });
        }
    }

    updateXRLocomotion(direction) {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.enabled) return;

        const session = render.renderer.xr.getSession();
        if (!session) return;

        // 1. Poll Gamepads for Locomotion/Jumping
        for (const source of session.inputSources) {
            if (source.gamepad) {
                const axes = source.gamepad.axes;
                const buttons = source.gamepad.buttons;

                if (source.handedness === 'left' && axes.length >= 4) {
                    const dx = axes[2] || 0;
                    const dz = axes[3] || 0;
                    // Add deadzone
                    if (Math.abs(dx) > 0.1) direction.x += dx;
                    if (Math.abs(dz) > 0.1) direction.z += dz;
                }

                if (source.handedness === 'right') {
                    if (axes.length >= 4 && Math.abs(axes[2]) > 0.5) {
                        this.yaw -= axes[2] * 0.05;
                    }
                    if (buttons[0].pressed && !this.wasJumpPressed) {
                        this.jump();
                        this.wasJumpPressed = true;
                    } else if (!buttons[0].pressed) {
                        this.wasJumpPressed = false;
                    }
                }
            }
        }
    }

    updateXRAvatarState() {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.enabled) return;

        const session = render.renderer.xr.getSession();
        if (!session) return;

        // 2. Poll Hand Tracking
        // In Three.js, getHand(0) and getHand(1) return Groups containing the joints
        const hand0 = render.renderer.xr.getHand(0);
        const hand1 = render.renderer.xr.getHand(1);

        let leftData = { active: false, rootPos: new THREE.Vector3(-0.4, 0, 0), rootQuat: new THREE.Quaternion() };
        let rightData = { active: false, rootPos: new THREE.Vector3(0.4, 0, 0), rootQuat: new THREE.Quaternion() };

        // 3. Fallback to Controllers if no Hand Tracking
        if (session) {
            for (let i = 0; i < 2; i++) {
                const controller = render.renderer.xr.getController(i);
                const handSource = session.inputSources[i];

                if (controller && handSource) {
                    const handedness = handSource.handedness;

                    // Only use controller if hand tracking isn't already driving this hand
                    if ((handedness === 'left' && !leftData.active) ||
                        (handedness === 'right' && !rightData.active)) {

                        const worldPos = new THREE.Vector3();
                        const worldQuat = new THREE.Quaternion();
                        controller.getWorldPosition(worldPos);
                        controller.getWorldQuaternion(worldQuat);
                        this.mesh.worldToLocal(worldPos);

                        if (handedness === 'left') {
                            leftData.active = true;
                            leftData.rootPos.copy(worldPos);
                            leftData.rootQuat.copy(worldQuat);
                        } else {
                            rightData.active = true;
                            rightData.rootPos.copy(worldPos);
                            rightData.rootQuat.copy(worldQuat);
                        }
                    }
                }
            }
        }
        // Attempt to determine handedness from underlying inputSources connected to hands.
        if (hand0.visible) leftData = this.avatar.processXRHand(hand0, 'left');
        if (hand1.visible) rightData = this.avatar.processXRHand(hand1, 'right');

        // Store for networking
        this.handStates.left.active = leftData.active;
        this.handStates.left.position.copy(leftData.rootPos);
        this.handStates.left.quaternion.copy(leftData.rootQuat);

        this.handStates.right.active = rightData.active;
        this.handStates.right.position.copy(rightData.rootPos);
        this.handStates.right.quaternion.copy(rightData.rootQuat);

        // Update Arms to connect to hands (or default positions if no hands tracked)
        this.avatar.updateArms(leftData.rootPos, rightData.rootPos);
    }

    getNetworkState() {
        if (!this.rigidBody) return null;

        const pos = this.rigidBody.translation();

        // Build Head Payload
        const headPos = this.avatar.getHeadPosition();
        const headQuat = this.avatar.getHeadQuaternion();
        const headPayload = {
            position: { x: headPos.x, y: headPos.y, z: headPos.z },
            quaternion: { x: headQuat.x, y: headQuat.y, z: headQuat.z, w: headQuat.w }
        };

        // Build Hands Payload
        const handsPayload = {
            left: {
                active: this.handStates.left.active,
                position: { x: this.handStates.left.position.x, y: this.handStates.left.position.y, z: this.handStates.left.position.z },
                quaternion: { x: this.handStates.left.quaternion.x, y: this.handStates.left.quaternion.y, z: this.handStates.left.quaternion.z, w: this.handStates.left.quaternion.w }
            },
            right: {
                active: this.handStates.right.active,
                position: { x: this.handStates.right.position.x, y: this.handStates.right.position.y, z: this.handStates.right.position.z },
                quaternion: { x: this.handStates.right.quaternion.x, y: this.handStates.right.quaternion.y, z: this.handStates.right.quaternion.z, w: this.handStates.right.quaternion.w }
            }
        };

        return {
            position: { x: pos.x, y: pos.y - 0.9, z: pos.z }, // Broadcast grounded position
            yaw: this.worldYaw !== undefined ? this.worldYaw : this.yaw,
            headHeight: this.headHeight,
            head: headPayload,
            hands: handsPayload
        };
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
