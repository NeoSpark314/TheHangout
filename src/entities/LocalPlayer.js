import * as THREE from 'three';
import { Avatar } from './Avatar.js';
import { PlayerEntity } from './PlayerEntity.js';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class LocalPlayer extends PlayerEntity {
    constructor(id, spawnPos, spawnYaw) {
        super(id || 'local-player-id-temp', 'LOCAL_PLAYER', true);

        this.speed = 5.0;
        this.turnSpeed = 0.002;

        // Legacy movement intent replaced by InputManager


        // --- Clean Architecture Transforms ---
        // xrOrigin is the physical center of the room (pinned to y=0)
        this.xrOrigin = new THREE.Object3D();
        if (spawnPos) this.xrOrigin.position.copy(spawnPos);

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
        this.yaw = spawnYaw || 0;
        this.xrOrigin.rotation.y = this.yaw;

        this.wasSnapTurnPressed = false;

        this.initAvatar();
        this.initInput();
    }

    initAvatar() {
        const { render } = gameState.managers;
        if (!render) return;

        this.avatar = new Avatar({ color: gameState.avatarConfig.color || 0x00ffff, isLocal: true });
        this.mesh = this.avatar.mesh;
        render.add(this.mesh);

        // Listen for live customization updates
        eventBus.on(EVENTS.AVATAR_CONFIG_UPDATED, (config) => {
            if (this.avatar) {
                this.avatar.setColor(config.color);
            }
        });
    }

    initInput() {
        // Keyboard and touch are now handled via InputManager
        const canvas = document.getElementById('app');
        canvas.addEventListener('click', () => {
            const { render } = gameState.managers;
            const isVR = render?.renderer?.xr?.isPresenting;
            if (!isVR) canvas.requestPointerLock();
        });

        document.addEventListener('mousemove', (e) => {
            const { render } = gameState.managers;
            const isVR = render?.renderer?.xr?.isPresenting;

            if (document.pointerLockElement === canvas && !isVR) {
                // Apply manual yaw/pitch for desktop
                this.applyTurn(-e.movementX * this.turnSpeed);
                this.pitch -= e.movementY * this.turnSpeed;
                this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            }
        });
    }


    update(delta) {
        const { render } = gameState.managers;
        if (!render) return;

        const isVR = render.renderer.xr.isPresenting;
        const activeCamera = render.camera; // In both modes, this is the main tracker

        // --- 1. ORIENTATION (Pitch Only) ---
        // Yaw is now handled incrementally via applyTurn()
        if (!isVR) {
            this.headPose.rotation.x = this.pitch;
        } else {
            // Capture physical height and pitch from the VR camera to ensure a smooth transition on exit
            this.headPose.position.copy(render.camera.position);

            const headEuler = new THREE.Euler().setFromQuaternion(render.camera.quaternion, 'YXZ');
            this.pitch = headEuler.x;
        }

        // --- 2. SYNC RENDERER TRANSFORMS ---
        render.cameraGroup.position.copy(this.xrOrigin.position);
        render.cameraGroup.quaternion.copy(this.xrOrigin.quaternion);

        if (!isVR) {
            render.camera.position.copy(this.headPose.position);
            render.camera.quaternion.copy(this.headPose.quaternion);
        }

        // Force a world matrix update on the hierarchy
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
                // Adjust sensitivities as needed
                this.applyTurn(-look.x * this.turnSpeed * 15);
                this.pitch -= look.y * this.turnSpeed * 15;
                this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            }
        }

        // 3c. VR Joysticks
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

            // Update world matrices after translation
            render.cameraGroup.position.copy(this.xrOrigin.position);
            render.cameraGroup.updateMatrixWorld(true);
        }

        // --- 4. MAP VR HANDS ---
        this.updateVRHands();

        // --- 5. VISUAL AVATAR ---
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

        // --- 6. TRANSFORM HANDS TO LOCAL AVATAR SPACE ---
        // Converts raw XR referenceSpace coordinates into this.mesh local space 
        this.transformHandsToAvatarSpace();

        // Natively update our own Avatar IK using the cleanly converted coordinates!
        this.avatar.updateWristMarkers(this.handStates.left, this.handStates.right, 1.0);

        const leftArmPos = this.handStates.left.active ? this.avatar.getLeftWristMarkerPosition() : new THREE.Vector3(-0.35, 0.85, 0.1);
        const rightArmPos = this.handStates.right.active ? this.avatar.getRightWristMarkerPosition() : new THREE.Vector3(0.35, 0.85, 0.1);
        this.avatar.updateArms(leftArmPos, rightArmPos);

        // --- 7. DEBUG UI ---
        if (gameState.managers.debugUI) {
            const oPos = this.xrOrigin.position;
            const oYaw = (this.yaw * 180 / Math.PI).toFixed(1);

            const hPos = headWorldPos;
            const hYaw = (headEuler.y * 180 / Math.PI).toFixed(1);
            const hPitch = (headEuler.x * 180 / Math.PI).toFixed(1);

            const debugText = `ORIGIN\nPos: ${oPos.x.toFixed(2)}, ${oPos.y.toFixed(2)}, ${oPos.z.toFixed(2)}\nYaw: ${oYaw}°\n\nHEAD (World)\nPos: ${hPos.x.toFixed(2)}, ${hPos.y.toFixed(2)}, ${hPos.z.toFixed(2)}\nDir: ${hYaw}°, ${hPitch}°`;
            gameState.managers.debugUI.updateDebugText(debugText);
        }

        // --- 7. NETWORK ---
        // Note: For network, we send the head world yaw as the 'yaw' to match visuals
        if (moveVector.lengthSq() > 0 || Math.abs(delta) > 0) {
            this.syncName();
            eventBus.emit(EVENTS.LOCAL_PLAYER_MOVED, this.getNetworkState());
        }
    }

    syncName() {
        if (gameState.playerName && this.name !== gameState.playerName) {
            this.name = gameState.playerName;
            this.avatar.setName(this.name);
        }
    }

    updateVRHands() {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.isPresenting) {
            this.handStates.left.active = false;
            this.handStates.right.active = false;
            return;
        }

        const session = render.renderer.xr.getSession();
        if (!session) return;

        // Default to inactive, turn on if source provides a pose
        this.handStates.left.active = false;
        this.handStates.right.active = false;

        const frame = render.renderer.xr.getFrame();
        const referenceSpace = render.renderer.xr.getReferenceSpace();

        if (!frame || !referenceSpace) return;

        for (const source of session.inputSources) {
            if (source.hand) {
                // TRUE HAND TRACKING
                const handState = source.handedness === 'left' ? this.handStates.left : this.handStates.right;
                handState.active = true;

                // Track root wrist position to drive the arm IK
                if (source.gripSpace) {
                    const wristPose = frame.getPose(source.gripSpace, referenceSpace);
                    if (wristPose) {
                        const handPoseObj = source.handedness === 'left' ? this.leftHandPose : this.rightHandPose;
                        handPoseObj.position.copy(wristPose.transform.position);
                        handPoseObj.quaternion.copy(wristPose.transform.orientation);
                    }
                }

                // Track the 25 individual joints
                let i = 0;
                for (const joint of source.hand.values()) {
                    if (i >= 25) break;
                    const jointPose = frame.getJointPose(joint, referenceSpace);
                    if (jointPose) {
                        handState.joints[i].position.copy(jointPose.transform.position);
                        handState.joints[i].quaternion.copy(jointPose.transform.orientation);
                    }
                    i++;
                }

            } else if (source.gripSpace) {
                // FALLBACK TO CONTROLLER GRIP
                const pose = frame.getPose(source.gripSpace, referenceSpace);
                if (pose) {
                    const handState = source.handedness === 'left' ? this.handStates.left : this.handStates.right;
                    const handPoseObj = source.handedness === 'left' ? this.leftHandPose : this.rightHandPose;

                    handState.active = true;
                    // Ensure the joint array is visually cleared/hidden for standard controllers
                    for (let i = 0; i < 25; i++) {
                        handState.joints[i].position.set(0, 0, 0);
                    }

                    handPoseObj.position.copy(pose.transform.position);
                    handPoseObj.quaternion.copy(pose.transform.orientation);
                }
            }
        }
    }

    transformHandsToAvatarSpace() {
        const { render } = gameState.managers;
        if (!render || !render.renderer.xr.isPresenting) return;

        // Ensure matrices are up to date before grabbing Inverse 
        this.mesh.updateMatrixWorld(true);
        this.xrOrigin.updateMatrixWorld(true);

        // LocalPlayer.mesh sits underneath the scene root.
        // xrOrigin sits underneath the scene root.
        // WebXR 'referenceSpace' poses are relative to xrOrigin.

        // Helper to transform a local XR coordinate into local Avatar coordinate
        const convertPose = (sourcePos, sourceQuat, targetPos, targetQuat) => {
            // 1. Get world coordinate of the XR tracking point
            const worldPos = sourcePos.clone();
            worldPos.applyMatrix4(this.xrOrigin.matrixWorld);

            const worldQuat = sourceQuat.clone();
            const xrOriginQuat = new THREE.Quaternion();
            this.xrOrigin.getWorldQuaternion(xrOriginQuat);
            worldQuat.premultiply(xrOriginQuat);

            // 2. Convert world coordinate into the Avatar.mesh's local space
            const localPos = this.mesh.worldToLocal(worldPos);

            const invMeshQuat = new THREE.Quaternion();
            this.mesh.getWorldQuaternion(invMeshQuat);
            invMeshQuat.invert();
            const localQuat = worldQuat.clone().premultiply(invMeshQuat);

            targetPos.copy(localPos);
            targetQuat.copy(localQuat);
        };

        if (this.handStates.left.active) {
            convertPose(this.leftHandPose.position, this.leftHandPose.quaternion, this.handStates.left.position, this.handStates.left.quaternion);
            for (let i = 0; i < 25; i++) {
                if (this.handStates.left.joints[i].position.lengthSq() > 0) {
                    // Joint is active (not zeroed), clone its pre-captured state and convert
                    const rawPos = this.handStates.left.joints[i].position.clone();
                    const rawQuat = this.handStates.left.joints[i].quaternion.clone();
                    convertPose(rawPos, rawQuat, this.handStates.left.joints[i].position, this.handStates.left.joints[i].quaternion);
                }
            }
        }

        if (this.handStates.right.active) {
            convertPose(this.rightHandPose.position, this.rightHandPose.quaternion, this.handStates.right.position, this.handStates.right.quaternion);
            for (let i = 0; i < 25; i++) {
                if (this.handStates.right.joints[i].position.lengthSq() > 0) {
                    // Joint is active (not zeroed), clone its pre-captured state and convert
                    const rawPos = this.handStates.right.joints[i].position.clone();
                    const rawQuat = this.handStates.right.joints[i].quaternion.clone();
                    convertPose(rawPos, rawQuat, this.handStates.right.joints[i].position, this.handStates.right.joints[i].quaternion);
                }
            }
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
        const { render } = gameState.managers;
        if (!render) return;

        // 1. Pivot Point: Where the head is in the WORLD currently
        const pivot = new THREE.Vector3();
        render.camera.getWorldPosition(pivot);

        // We only care about X/Z for origin pivoting to stay on floor
        const pivotXZ = new THREE.Vector3(pivot.x, 0, pivot.z);

        // 2. The Math:
        // Translate origin so head is at 0,0,0 in world
        // Rotate origin
        // Translate origin back
        this.xrOrigin.position.sub(pivotXZ);
        this.xrOrigin.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), deltaYaw);
        this.xrOrigin.position.add(pivotXZ);

        // Update internal yaw tracking
        this.yaw += deltaYaw;
        this.xrOrigin.rotation.y = this.yaw;
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

        render.camera.getWorldPosition(headWorldPos);
        render.camera.getWorldQuaternion(headWorldQuat);

        const headEuler = new THREE.Euler().setFromQuaternion(headWorldQuat, 'YXZ');
        const bodyYaw = headEuler.y;

        const bodyQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bodyYaw, 0, 'YXZ'));
        const localHeadQuat = bodyQuat.invert().multiply(headWorldQuat);

        const serializeHand = (handState) => {
            const data = {
                active: handState.active,
                position: { x: handState.position.x, y: handState.position.y, z: handState.position.z },
                quaternion: { x: handState.quaternion.x, y: handState.quaternion.y, z: handState.quaternion.z, w: handState.quaternion.w },
                joints: []
            };

            // Only serialize joints if we actually captured valid spatial data
            if (handState.active && handState.joints[0].position.lengthSq() > 0) {
                for (let i = 0; i < 25; i++) {
                    const j = handState.joints[i];
                    data.joints.push({
                        p: { x: j.position.x, y: j.position.y, z: j.position.z },
                        q: { x: j.quaternion.x, y: j.quaternion.y, z: j.quaternion.z, w: j.quaternion.w }
                    });
                }
            }
            return data;
        };

        return {
            id: this.id, // Explicitly include ID for relay
            type: this.type,
            name: this.name,
            position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
            yaw: bodyYaw,
            headHeight: headWorldPos.y,
            head: {
                position: { x: headWorldPos.x, y: headWorldPos.y, z: headWorldPos.z },
                quaternion: { x: localHeadQuat.x, y: localHeadQuat.y, z: localHeadQuat.z, w: localHeadQuat.w }
            },
            hands: {
                left: serializeHand(this.handStates.left),
                right: serializeHand(this.handStates.right)
            },
            avatarConfig: gameState.avatarConfig
        };
    }

    destroy() {
        super.destroy(); // Call base NetworkEntity.destroy() to set destroyed = true
        const { render } = gameState.managers;
        if (render && this.mesh) {
            render.remove(this.mesh);
            this.avatar.destroy();
        }
    }
}
