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

        this.neckHeight = 0.6; // Current dynamic neck height

        this.initAvatar();
        this.initInput();
    }

    initAvatar() {
        const { render, physics } = gameState.managers;
        if (!render || !physics) return;

        // --- Visible Avatar (Stick Figure) ---
        // Create root group for the avatar visual
        this.mesh = new THREE.Group();

        // Materials (Neon Cyan)
        const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff });
        const solidDark = new THREE.MeshBasicMaterial({ color: 0x050510, side: THREE.DoubleSide });

        // 1. Head (Flat Square with Canvas Texture)
        const headSize = 0.4;
        const headGeometry = new THREE.PlaneGeometry(headSize, headSize);
        // Rotate geometry to face forward (-Z)
        headGeometry.rotateY(Math.PI);
        // Offset geometry so anchor (0,0,0) is at the bottom edge (the neck)
        headGeometry.translate(0, headSize / 2, 0);

        // Placeholder Canvas Texture (256x256)
        this.headCanvas = document.createElement('canvas');
        this.headCanvas.width = 256;
        this.headCanvas.height = 256;
        const ctx = this.headCanvas.getContext('2d');
        ctx.fillStyle = '#0a041c'; // Dark background
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 10;
        ctx.strokeRect(10, 10, 236, 236); // Simple border
        // Smiley Face Placeholder
        ctx.beginPath();
        ctx.arc(80, 80, 20, 0, Math.PI * 2);
        ctx.arc(176, 80, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(128, 140, 60, 0.2, Math.PI - 0.2);
        ctx.stroke();

        this.headTexture = new THREE.CanvasTexture(this.headCanvas);
        const headMaterial = new THREE.MeshBasicMaterial({ map: this.headTexture, side: THREE.DoubleSide });

        this.headMesh = new THREE.Mesh(headGeometry, headMaterial);
        // Add neon border to head
        const headEdges = new THREE.EdgesGeometry(headGeometry);
        const headOutline = new THREE.LineSegments(headEdges, outlineMaterial);
        this.headMesh.add(headOutline);

        this.headMesh.position.y = 0.6; // Position at neck height

        // Hide head from local camera using layers
        // Default camera is layer 0. We put head on layer 1.
        this.headMesh.traverse(child => child.layers.set(1));

        this.mesh.add(this.headMesh);

        // 2. Torso (Vertical Line)
        const torsoGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.6, 0), // Base of neck
            new THREE.Vector3(0, -0.2, 0) // Waist
        ]);
        this.torso = new THREE.Line(torsoGeom, outlineMaterial);
        this.mesh.add(this.torso);

        // 3. Legs
        const legGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.15, -0.2, 0), // Left Waist
            new THREE.Vector3(-0.15, -1.0, 0), // Left Foot
            new THREE.Vector3(0.15, -0.2, 0),  // Right Waist
            new THREE.Vector3(0.15, -1.0, 0)   // Right Foot
        ]);
        // To draw them as disconnected segments, we need pairs
        const legsSegments = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(-0.2, -1.0, 0), // Left leg
            new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.2, -1.0, 0)  // Right leg
        ]);
        this.legs = new THREE.LineSegments(legsSegments, outlineMaterial);
        this.mesh.add(this.legs);

        // 4. Shoulders (Horizontal Line)
        const shoulderGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.25, 0, 0), new THREE.Vector3(0.25, 0, 0)
        ]);
        this.shoulders = new THREE.Line(shoulderGeom, outlineMaterial);
        this.shoulders.position.y = 0.5; // Start at default
        this.mesh.add(this.shoulders);

        // 5. Arms (Shoulder -> Elbow -> Wrist)
        this.arms = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            outlineMaterial
        );
        this.mesh.add(this.arms);

        render.add(this.mesh);

        // --- Physics Body ---
        const startPos = { x: 0, y: 5, z: 0 };

        // Keep dynamic capsule for physical interaction/collisions
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(startPos.x, startPos.y, startPos.z)
            .lockRotations();

        this.rigidBody = physics.world.createRigidBody(rigidBodyDesc);

        // Height is 2.0 total (-1.0 to 1.0 local)
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.3); // half-height, radius
        physics.world.createCollider(colliderDesc, this.rigidBody);

        physics.dynamicBodies.push({
            mesh: this.mesh,
            rigidBody: this.rigidBody
        });

        // --- XR Hand Tracking Visuals ---
        this.handMeshes = { left: [], right: [] };
        const jointGeom = new THREE.BoxGeometry(0.015, 0.015, 0.015);
        const jointMatLeft = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        const jointMatRight = new THREE.MeshBasicMaterial({ color: 0xff00ff });

        for (let i = 0; i < 25; i++) {
            const leftJoint = new THREE.Mesh(jointGeom, jointMatLeft);
            leftJoint.visible = false;
            this.mesh.add(leftJoint);
            this.handMeshes.left.push(leftJoint);

            const rightJoint = new THREE.Mesh(jointGeom, jointMatRight);
            rightJoint.visible = false;
            this.mesh.add(rightJoint);
            this.handMeshes.right.push(rightJoint);
        }
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
        render.cameraGroup.rotation.set(0, this.yaw, 0, 'YXZ');
        render.camera.rotation.set(this.pitch, 0, 0, 'YXZ');

        // Update dynamic neck height based on camera
        // render.cameraGroup is at the player's root + 0.8 offset (line 223)
        // render.camera is the HMD offset from that group.
        // We want the neck height to be slightly below the camera
        const cameraWorldPos = new THREE.Vector3();
        render.camera.getWorldPosition(cameraWorldPos);
        const playerWorldPos = new THREE.Vector3();
        this.mesh.getWorldPosition(playerWorldPos);

        // Height of head above player ground
        const headHeight = cameraWorldPos.y - playerWorldPos.y;
        this.neckHeight = Math.max(0.2, headHeight - 0.2); // Neck is ~20cm below eyes

        // Update avatar pieces to match new neck height
        this.headMesh.position.y = this.neckHeight;
        this.shoulders.position.y = this.neckHeight - 0.1; // Shoulders 10cm below neck

        // Update Torso Geometry (Shoulder to Waist)
        const torsoPoints = [
            new THREE.Vector3(0, this.neckHeight, 0),
            new THREE.Vector3(0, -0.2, 0) // Waist is fixed
        ];
        this.torso.geometry.setFromPoints(torsoPoints);

        // Update Local Head Mesh to match camera orientation for others to see
        if (render.renderer.xr.enabled && render.renderer.xr.isPresenting) {
            // In VR, the camera world quaternion is the true head orientation
            const worldQuat = new THREE.Quaternion();
            render.camera.getWorldQuaternion(worldQuat);

            // Convert to local space of the player mesh
            const playerWorldQuat = new THREE.Quaternion();
            this.mesh.getWorldQuaternion(playerWorldQuat);
            this.headMesh.quaternion.copy(playerWorldQuat.invert().multiply(worldQuat));
        } else {
            // In Desktop, head just follows pitch (yaw is handled by body)
            this.headMesh.rotation.set(this.pitch, 0, 0);
        }

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

        let leftHandActive = false;
        let rightHandActive = false;
        const leftHandRoot = new THREE.Vector3();
        const rightHandRoot = new THREE.Vector3();

        // 1. Poll Gamepads for Locomotion/Jumping
        for (const source of session.inputSources) {
            if (source.gamepad) {
                const axes = source.gamepad.axes;
                const buttons = source.gamepad.buttons;

                if (source.handedness === 'left' && axes.length >= 4) {
                    direction.x += axes[2] || 0;
                    direction.z += axes[3] || 0;
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

        // 2. Poll Hand Tracking
        // In Three.js, getHand(0) and getHand(1) return Groups containing the joints
        const hand0 = render.renderer.xr.getHand(0);
        const hand1 = render.renderer.xr.getHand(1);

        const processHand = (hand, handednessStr) => {
            const meshes = this.handMeshes[handednessStr];
            let active = false;
            let rootPos = new THREE.Vector3();

            // Hand joints are populated if tracking is active
            if (hand && hand.joints && Object.keys(hand.joints).length > 0) {
                active = true;
                // Convert world space joints to player local space
                let i = 0;
                for (const [jointName, jointGroup] of Object.entries(hand.joints)) {
                    if (i >= 25) break;

                    if (jointGroup.visible) {
                        meshes[i].visible = true;

                        // Get world position/rotation
                        const worldPos = new THREE.Vector3();
                        const worldQuat = new THREE.Quaternion();
                        jointGroup.getWorldPosition(worldPos);
                        jointGroup.getWorldQuaternion(worldQuat);

                        // Convert to LocalPlayer mesh space
                        this.mesh.worldToLocal(worldPos);
                        meshes[i].position.copy(worldPos);

                        // Simplify rotation sync for now
                        meshes[i].quaternion.copy(worldQuat);

                        if (jointName === 'wrist') {
                            rootPos.copy(worldPos);
                        }
                    } else {
                        meshes[i].visible = false;
                    }
                    i++;
                }
            } else {
                for (let i = 0; i < 25; i++) {
                    meshes[i].visible = false;
                }
            }
            return { active, rootPos };
        };

        let leftData = { active: false, rootPos: new THREE.Vector3(-0.4, 0, 0) };
        let rightData = { active: false, rootPos: new THREE.Vector3(0.4, 0, 0) };

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
                        controller.getWorldPosition(worldPos);
                        this.mesh.worldToLocal(worldPos);

                        if (handedness === 'left') {
                            leftData.active = true;
                            leftData.rootPos.copy(worldPos);
                        } else {
                            rightData.active = true;
                            rightData.rootPos.copy(worldPos);
                        }
                    }
                }
            }
        }
        // Attempt to determine handedness from underlying inputSources connected to hands.
        // A robust implementation checks the XRInputSources, but let's assume standard order for local testing or update the arm IK simply.
        if (hand0.visible) leftData = processHand(hand0, 'left');
        if (hand1.visible) rightData = processHand(hand1, 'right');

        // Update Arms to connect to hands (or default positions if no hands tracked)
        this.updateArms(leftData.rootPos, rightData.rootPos);
    }

    updateArms(leftHandPos, rightHandPos) {
        const shoulderY = this.neckHeight - 0.1;
        const leftShoulder = new THREE.Vector3(-0.25, shoulderY, 0);
        const rightShoulder = new THREE.Vector3(0.25, shoulderY, 0);

        // Improved Elbow IK Helper
        const calculateElbow = (shoulder, hand) => {
            const dist = shoulder.distanceTo(hand);
            const mid = new THREE.Vector3().lerpVectors(shoulder, hand, 0.5);

            // Calculate a bend direction that is perpendicular to the arm-line 
            // and generally points down and slightly out/back
            const armDir = new THREE.Vector3().subVectors(hand, shoulder).normalize();
            const down = new THREE.Vector3(0, -1, 0);
            const side = new THREE.Vector3().crossVectors(armDir, down).normalize();

            // Heuristic for elbow bend: more bend when hand is closer to shoulder
            const bendAmount = Math.max(0, 0.4 - dist * 0.5);

            // Bend result: downwards + slightly inwards/outwards depending on side
            const bend = new THREE.Vector3(0, -bendAmount, -bendAmount * 0.5);
            // Add a bit of "side" flare
            bend.addScaledVector(side, shoulder.x > 0 ? 0.1 : -0.1);

            return mid.add(bend);
        };

        const leftElbow = calculateElbow(leftShoulder, leftHandPos);
        const rightElbow = calculateElbow(rightShoulder, rightHandPos);

        const positions = new Float32Array([
            // Left Arm
            leftShoulder.x, leftShoulder.y, leftShoulder.z,
            leftElbow.x, leftElbow.y, leftElbow.z,
            leftElbow.x, leftElbow.y, leftElbow.z,
            leftHandPos.x, leftHandPos.y, leftHandPos.z,
            // Right Arm
            rightShoulder.x, rightShoulder.y, rightShoulder.z,
            rightElbow.x, rightElbow.y, rightElbow.z,
            rightElbow.x, rightElbow.y, rightElbow.z,
            rightHandPos.x, rightHandPos.y, rightHandPos.z
        ]);

        this.arms.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.arms.geometry.computeBoundingSphere();
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
