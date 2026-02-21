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

        // Rotation
        this.pitch = 0;
        this.yaw = 0;

        this.initAvatar();
        this.initInput();
    }

    initAvatar() {
        const { render } = gameState.managers;
        if (!render) return;

        // Instantiate unified Avatar entity, marked as local
        this.avatar = new Avatar({ color: 0x00ffff, isLocal: true });
        this.mesh = this.avatar.mesh; // Root visual group

        render.add(this.mesh);
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
                this.applyTurn(-e.movementX * this.turnSpeed);
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
        if (!render) return;

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
        }

        // Apply rotation to the xrOrigin representing physical movement space
        render.cameraGroup.rotation.y = this.yaw;

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

        // Force floor height to 0
        render.cameraGroup.position.y = 0;

        // 3. Absolute Avatar Placement
        // The visual footprint is precisely at the world X/Z of the active camera (physical headset)
        const cameraWorldPos = new THREE.Vector3();
        activeCamera.getWorldPosition(cameraWorldPos);

        // Ground the mesh at exactly y=0
        this.mesh.position.set(cameraWorldPos.x, 0, cameraWorldPos.z);

        // 4. Update heights and head rotation
        this.headHeight = Math.max(0.4, cameraWorldPos.y); // Relative to zero
        this.avatar.updatePosture(this.headHeight);

        // Update body rotation to face HMD yaw so others see the body follow the head
        this.mesh.rotation.y = hmdEuler.y;
        this.worldYaw = hmdEuler.y;
        this.mesh.updateMatrixWorld(true);

        // Calculate head rotation RELATIVE to the newly rotated body
        const playerWorldQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hmdEuler.y, 0, 'YXZ'));
        const localHeadQuat = playerWorldQuat.invert().multiply(hmdQuat);
        this.avatar.updateHeadOrientation(localHeadQuat);

        // 5. Update XR Hands/Arms
        this.updateXRAvatarState();

        // 6. Network Emission
        if (direction.lengthSq() > 0 || Math.abs(this.yaw) > 0.001) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, {
                position: this.mesh.position,
                rotation: { pitch: this.pitch, yaw: this.yaw }
            });
        }
    }

    updateXRLocomotion(direction) {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.enabled) return;

        const session = render.renderer.xr.getSession();
        if (!session) return;

        // Poll Gamepads for Locomotion
        for (const source of session.inputSources) {
            if (source.gamepad) {
                const axes = source.gamepad.axes;

                if (source.handedness === 'left') {
                    const xIdx = axes.length >= 4 ? 2 : 0;
                    const zIdx = axes.length >= 4 ? 3 : 1;
                    const dx = axes[xIdx] || 0;
                    const dz = axes[zIdx] || 0;
                    if (Math.abs(dx) > 0.1) direction.x += dx;
                    if (Math.abs(dz) > 0.1) direction.z += dz;
                }

                if (source.handedness === 'right') {
                    const xIdx = axes.length >= 4 ? 2 : 0;
                    if (axes.length > xIdx && Math.abs(axes[xIdx]) > 0.5) {
                        if (!this.wasSnapTurnPressed) {
                            const sign = Math.sign(axes[xIdx]);
                            const turnAngle = sign * (-Math.PI / 4); // 45 degrees
                            this.applyTurn(turnAngle);
                            this.wasSnapTurnPressed = true;
                        }
                    } else {
                        this.wasSnapTurnPressed = false;
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

        const hand0 = render.renderer.xr.getHand(0);
        const hand1 = render.renderer.xr.getHand(1);

        let leftData = { active: false, rootPos: new THREE.Vector3(-0.4, 0, 0), rootQuat: new THREE.Quaternion() };
        let rightData = { active: false, rootPos: new THREE.Vector3(0.4, 0, 0), rootQuat: new THREE.Quaternion() };

        if (session) {
            for (let i = 0; i < 2; i++) {
                const controller = render.renderer.xr.getController(i);
                const handSource = session.inputSources[i];

                if (controller && handSource) {
                    const handedness = handSource.handedness;

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

        if (hand0.visible) leftData = this.avatar.processXRHand(hand0, 'left');
        if (hand1.visible) rightData = this.avatar.processXRHand(hand1, 'right');

        this.handStates.left.active = leftData.active;
        this.handStates.left.position.copy(leftData.rootPos);
        this.handStates.left.quaternion.copy(leftData.rootQuat);

        this.handStates.right.active = rightData.active;
        this.handStates.right.position.copy(rightData.rootPos);
        this.handStates.right.quaternion.copy(rightData.rootQuat);

        this.avatar.updateArms(leftData.rootPos, rightData.rootPos);
    }

    getNetworkState() {
        const headPos = this.avatar.getHeadPosition();
        const headQuat = this.avatar.getHeadQuaternion();

        return {
            position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
            yaw: this.worldYaw !== undefined ? this.worldYaw : this.yaw,
            headHeight: this.headHeight,
            head: {
                position: { x: headPos.x, y: headPos.y, z: headPos.z },
                quaternion: { x: headQuat.x, y: headQuat.y, z: headQuat.z, w: headQuat.w }
            },
            hands: {
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
            }
        };
    }

    applyTurn(deltaYaw) {
        this.yaw += deltaYaw;
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
