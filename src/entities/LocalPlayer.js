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

        // 1. Calculate intent direction (World Space)
        const direction = new THREE.Vector3(0, 0, 0);

        // Keyboard Input (Flat/Desktop style)
        if (this.keys.w) direction.z -= 1; // Forward is -Z
        if (this.keys.s) direction.z += 1;
        if (this.keys.a) direction.x -= 1;
        if (this.keys.d) direction.x += 1;

        // XR Locomotion Update (Joysticks)
        this.updateXRLocomotion(direction);
        direction.normalize();

        const isXR = render.renderer.xr.enabled && render.renderer.xr.isPresenting;
        const activeCamera = isXR ? render.renderer.xr.getCamera(render.camera) : render.camera;

        // --- Core Alignment: Desktop behaves exactly like a fixed-position VR Headset ---
        if (!isXR) {
            // Desktop simulate 1.7m headset, local to cameraGroup
            render.camera.position.set(0, 1.7, 0);
            render.camera.rotation.set(this.pitch, 0, 0, 'YXZ');
            // Desktop yaw is historically applied to cameraGroup
            render.cameraGroup.rotation.set(0, this.yaw, 0, 'YXZ');
        }

        // Apply intent relative to the active view orientation
        // We extract the physical space HMD yaw from the active camera
        const hmdQuat = new THREE.Quaternion();
        activeCamera.getWorldQuaternion(hmdQuat);
        const hmdEuler = new THREE.Euler().setFromQuaternion(hmdQuat, 'YXZ');
        const moveEuler = new THREE.Euler(0, hmdEuler.y, 0, 'YXZ');
        direction.applyEuler(moveEuler);

        // 2. Apply explicit translation to the Virtual Origin (xrOrigin / cameraGroup)
        const frameSpeed = this.speed * delta;
        render.cameraGroup.position.x += direction.x * frameSpeed;
        render.cameraGroup.position.z += direction.z * frameSpeed;

        // 3. Snap Physics Body exactly beneath the perceived Active Camera (Head)
        const cameraWorldPos = new THREE.Vector3();
        activeCamera.getWorldPosition(cameraWorldPos);

        const pos = this.rigidBody.translation();
        this.rigidBody.setTranslation({ x: cameraWorldPos.x, y: pos.y, z: cameraWorldPos.z }, true);

        // We zero out manual X/Z velocities in Rapier since we drive physics explicitly via translation
        const currentVel = this.rigidBody.linvel();
        this.rigidBody.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);

        // 4. Update Visual Avatar Mesh Root
        // The mesh should be grounded at the very bottom of the physics capsule
        const groundY = pos.y - 0.9;

        // Ensure XR floor tracking: Lock cameraGroup Y directly to the physics floor bound
        if (isXR) {
            render.cameraGroup.position.y = groundY;
        }

        this.mesh.position.set(cameraWorldPos.x, groundY, cameraWorldPos.z);

        // 5. Update heights and Head logic
        const playerWorldPos = new THREE.Vector3();
        this.mesh.getWorldPosition(playerWorldPos);

        this.headHeight = Math.max(0.4, cameraWorldPos.y - playerWorldPos.y);
        this.avatar.updatePosture(this.headHeight);

        // Update body rotation to face HMD yaw so others see the body follow the head
        this.mesh.rotation.y = hmdEuler.y;
        this.worldYaw = hmdEuler.y;
        this.mesh.updateMatrixWorld(true);

        // Calculate head rotation RELATIVE to the newly rotated body
        const playerWorldQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hmdEuler.y, 0, 'YXZ'));
        const localHeadQuat = playerWorldQuat.invert().multiply(hmdQuat);
        this.avatar.updateHeadOrientation(localHeadQuat);

        // 6. Update XR Hands/Arms
        this.updateXRAvatarState();

        // 7. Network Emission
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

                if (source.handedness === 'left') {
                    const xIdx = axes.length >= 4 ? 2 : 0;
                    const zIdx = axes.length >= 4 ? 3 : 1;
                    const dx = axes[xIdx] || 0;
                    const dz = axes[zIdx] || 0;
                    // Add deadzone
                    if (Math.abs(dx) > 0.1) direction.x += dx;
                    if (Math.abs(dz) > 0.1) direction.z += dz;
                }

                if (source.handedness === 'right') {
                    // Snap-turn / Smooth-turn on right stick X
                    const xIdx = axes.length >= 4 ? 2 : 0;
                    if (axes.length > xIdx && Math.abs(axes[xIdx]) > 0.5) {
                        const isSnapTurning = true; // Could be a user setting

                        // We only want to trigger snap turn ONCE per stick deflection
                        if (isSnapTurning) {
                            if (!this.wasSnapTurnPressed) {
                                const sign = Math.sign(axes[xIdx]);
                                const turnAngle = sign * (-Math.PI / 4); // 45 degrees
                                this.applyTurn(turnAngle);
                                this.wasSnapTurnPressed = true;
                            }
                        } else {
                            // Smooth Turn
                            this.applyTurn(-axes[xIdx] * 0.05);
                        }
                    } else {
                        this.wasSnapTurnPressed = false;
                    }

                    if (buttons.length > 0 && buttons[0].pressed && !this.wasJumpPressed) {
                        this.jump();
                        this.wasJumpPressed = true;
                    } else if (buttons.length > 0 && !buttons[0].pressed) {
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
                            const invMeshQuat = this.mesh.quaternion.clone().invert();
                            leftData.rootQuat.copy(worldQuat).premultiply(invMeshQuat);
                        } else {
                            rightData.active = true;
                            rightData.rootPos.copy(worldPos);
                            const invMeshQuat = this.mesh.quaternion.clone().invert();
                            rightData.rootQuat.copy(worldQuat).premultiply(invMeshQuat);
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
            position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z }, // Broadcast true grounded head coords
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

    applyTurn(deltaYaw) {
        const { render } = gameState.managers;
        if (!render) return;

        const isXR = render.renderer.xr.enabled && render.renderer.xr.isPresenting;
        if (!isXR) return;

        // When a user physically walks away from the virtual center `cameraGroup`,
        // rotating the `cameraGroup` swings them in a wide arc.
        // To pivot them exactly where they stand, we find the local physical HMD offset in X/Z,
        // rotate it by the new angle, and subtract the difference from the `cameraGroup` position.

        const xrCamera = render.renderer.xr.getCamera(render.camera);

        // 1. Get the current absolute position of the HMD in world space
        const cameraWorldPosBefore = new THREE.Vector3();
        xrCamera.getWorldPosition(cameraWorldPosBefore);

        // Calculate the HMD's local offset relative to the camera group
        const hmdLocalPos = cameraWorldPosBefore.clone();
        render.cameraGroup.worldToLocal(hmdLocalPos);

        // 2. Apply rotation to the camera group
        render.cameraGroup.rotation.y += deltaYaw;
        this.yaw += deltaYaw;
        render.cameraGroup.updateMatrixWorld(true);

        // 3. Find where the HMD is in world space AFTER rotating the cameraGroup
        const cameraWorldPosAfter = hmdLocalPos.clone();
        render.cameraGroup.localToWorld(cameraWorldPosAfter);

        // 4. The HMD moved by this world delta due to the group's rotation.
        // We shift the cameraGroup in world space to perfectly negate this movement.
        const deltaWorld = cameraWorldPosAfter.sub(cameraWorldPosBefore);
        // Only negate X/Z to keep gravity logic intact
        render.cameraGroup.position.x -= deltaWorld.x;
        render.cameraGroup.position.z -= deltaWorld.z;
        render.cameraGroup.updateMatrixWorld(true);
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
