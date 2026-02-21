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

        this.wasSnapTurnPressed = false;

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
            const { render } = gameState.managers;
            const isVR = render?.renderer?.xr?.isPresenting;

            if (document.pointerLockElement === canvas && !isVR) {
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

        const isVR = render.renderer.xr.isPresenting;

        // --- 1. ORIENTATION ---
        // Apply yaw to our internal transforms
        this.xrOrigin.rotation.y = this.yaw;

        if (!isVR) {
            this.headPose.rotation.x = this.pitch;
        } else {
            // In VR, the HMD transform is handled by the headset.
            // We clear any simulation offsets.
            this.headPose.position.set(0, 0, 0);
            this.headPose.quaternion.set(0, 0, 0, 1);
        }

        // --- 2. SYNC RENDERER TRANSFORMS ---
        render.cameraGroup.position.copy(this.xrOrigin.position);
        render.cameraGroup.quaternion.copy(this.xrOrigin.quaternion);

        if (!isVR) {
            render.camera.position.copy(this.headPose.position);
            render.camera.quaternion.copy(this.headPose.quaternion);
        } else {
            // In VR, DO NOT overwrite render.camera transform. 
            // Three.js manages it relative to cameraGroup.
        }

        // Force a world matrix update on the hierarchy so getWorldPose works
        render.cameraGroup.updateMatrixWorld(true);

        // --- 3. LOCOMOTION ---
        const moveVector = new THREE.Vector3(0, 0, 0);

        // Desktop keys
        if (this.keys.w) moveVector.z -= 1;
        if (this.keys.s) moveVector.z += 1;
        if (this.keys.a) moveVector.x -= 1;
        if (this.keys.d) moveVector.x += 1;

        // VR Joysticks
        this.updateVRLocomotion(moveVector);

        if (moveVector.lengthSq() > 0) {
            moveVector.normalize();

            // Extract the FINAL world heading from the camera
            const headWorldQuat = new THREE.Quaternion();
            render.camera.getWorldQuaternion(headWorldQuat);
            const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');

            // Move relative to the world-space heading of the head
            moveVector.applyEuler(new THREE.Euler(0, headEuler.y, 0, 'YXZ'));
            this.xrOrigin.position.addScaledVector(moveVector, this.speed * delta);

            // Re-sync position and update world matrices again to ensure next steps are accurate
            render.cameraGroup.position.copy(this.xrOrigin.position);
            render.cameraGroup.updateMatrixWorld(true);
        }

        // --- 4. VISUAL AVATAR ---
        const headWorldPos = new THREE.Vector3();
        render.camera.getWorldPosition(headWorldPos);
        const headWorldQuat = new THREE.Quaternion();
        render.camera.getWorldQuaternion(headWorldQuat);
        const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');

        // Avatar feet pinned to ground exactly below head
        this.mesh.position.set(headWorldPos.x, 0, headWorldPos.z);
        this.avatar.updatePosture(headWorldPos.y);

        // Body heading follows head world yaw
        this.mesh.rotation.y = headEuler.y;

        // Neck rotation (absolute head orientation relative to body yaw)
        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, headEuler.y, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.invert().multiply(headWorldQuat);
        this.avatar.updateHeadOrientation(localHeadQuat);

        // Arms (static relative to origin for now)
        this.avatar.updateArms(this.leftHandPose.position, this.rightHandPose.position);

        // --- 5. DEBUG UI ---
        if (gameState.managers.debugUI) {
            const oPos = this.xrOrigin.position;
            const oYaw = (this.yaw * 180 / Math.PI).toFixed(1);

            const hPos = headWorldPos;
            const hYaw = (headEuler.y * 180 / Math.PI).toFixed(1);
            const hPitch = (headEuler.x * 180 / Math.PI).toFixed(1);

            const debugText = `ORIGIN\nPos: ${oPos.x.toFixed(2)}, ${oPos.y.toFixed(2)}, ${oPos.z.toFixed(2)}\nYaw: ${oYaw}°\n\nHEAD (World)\nPos: ${hPos.x.toFixed(2)}, ${hPos.y.toFixed(2)}, ${hPos.z.toFixed(2)}\nDir: ${hYaw}°, ${hPitch}°`;
            gameState.managers.debugUI.updateDebugText(debugText);
        }

        // --- 6. NETWORK ---
        if (moveVector.lengthSq() > 0 || Math.abs(this.yaw) > 0.001) {
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, this.getNetworkState());
        }
    }

    updateVRLocomotion(moveVector) {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.isPresenting) return;

        const session = render.renderer.xr.getSession();
        if (!session) return;

        for (const source of session.inputSources) {
            if (source.gamepad) {
                const axes = source.gamepad.axes;

                // Left Stick (Locomotion)
                if (source.handedness === 'left') {
                    const xIdx = axes.length >= 4 ? 2 : 0;
                    const zIdx = axes.length >= 4 ? 3 : 1;
                    const dx = axes[xIdx] || 0;
                    const dz = axes[zIdx] || 0;

                    if (Math.abs(dx) > 0.1) moveVector.x += dx;
                    if (Math.abs(dz) > 0.1) moveVector.z += dz;
                }

                // Right Stick (Snap Turn)
                if (source.handedness === 'right') {
                    const xIdx = axes.length >= 4 ? 2 : 0;
                    if (axes.length > xIdx && Math.abs(axes[xIdx]) > 0.5) {
                        if (!this.wasSnapTurnPressed) {
                            const sign = Math.sign(axes[xIdx]);
                            const turnAngle = sign * (-Math.PI / 4); // 45 degrees
                            this.applyTurn(turnAngle);
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

    getNetworkState() {
        const headWorldPos = new THREE.Vector3();
        const headWorldQuat = new THREE.Quaternion();
        const { render } = gameState.managers;
        if (!render) return {};

        render.camera.updateMatrixWorld(true);
        render.camera.getWorldPosition(headWorldPos);
        render.camera.getWorldQuaternion(headWorldQuat);

        const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');
        const bodyYaw = headEuler.y;

        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.invert().multiply(headWorldQuat);

        return {
            position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
            yaw: bodyYaw,
            headHeight: headWorldPos.y,
            head: {
                position: { x: headWorldPos.x, y: headWorldPos.y, z: headWorldPos.z },
                quaternion: { x: localHeadQuat.x, y: localHeadQuat.y, z: localHeadQuat.z, w: localHeadQuat.w }
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
