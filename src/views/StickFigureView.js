// views/StickFigureView.js

import * as THREE from 'three';
import { EntityView } from './EntityView.js';
import gameState from '../core/GameState.js';

/**
 * Cyberpunk stick-figure avatar.
 *
 * Renders: cube head, torso line, legs, shoulders, IK arms,
 * XR hand-tracking skeleton, wrist markers, and a name tag.
 *
 * Used for both local and remote players. The `isLocal` flag
 * controls whether the head is hidden (first-person view).
 *
 * State contract (passed to update()):
 *   position       - THREE.Vector3   feet/root world position
 *   yaw            - number          body heading (radians)
 *   headHeight     - number          eye-level height in meters
 *   headQuaternion - THREE.Quaternion local head rotation relative to body
 *   handStates     - { left, right } hand tracking data
 *   name           - string          display name
 *   color          - string|number   avatar accent color
 *   isLocal        - boolean         first-person (hide head)?
 *   lerpFactor     - number          interpolation weight (1.0 = snap)
 */
export class StickFigureView extends EntityView {
    constructor({ color = 0x00ffff, isLocal = false } = {}) {
        super();
        this.color = color;
        this.isLocal = isLocal;

        this.mesh = new THREE.Group();
        this.currentHeadHeight = 1.7;

        this._buildGeometry();
    }

    // ─── Standard WebXR hand-joint indices for skeleton lines ────────
    static HAND_INDICES = [
        0, 1, 1, 2, 2, 3, 3, 4,                           // thumb
        0, 5, 5, 6, 6, 7, 7, 8, 8, 9,                     // index
        0, 10, 10, 11, 11, 12, 12, 13, 13, 14,             // middle
        0, 15, 15, 16, 16, 17, 17, 18, 18, 19,             // ring
        0, 20, 20, 21, 21, 22, 22, 23, 23, 24              // pinky
    ];

    // ─── Geometry Construction ───────────────────────────────────────

    _buildGeometry() {
        // Materials
        this.accentMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        this.cyberMaterial = new THREE.MeshBasicMaterial({ color: 0x1a1a1a }); // Uniform "cyber" dark grey
        this.darkMaterial = new THREE.MeshBasicMaterial({ color: 0x050510 });
        this.featureMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

        // 1. Head (Box)
        const headSize = 0.3;
        const headDepth = 0.12; // Flattened front-to-back for a funnier look
        const headGeometry = new THREE.BoxGeometry(headSize, headSize, headDepth);
        headGeometry.translate(0, headSize / 2, 0);

        const faceMaterial = this.accentMaterial;
        const materials = [this.darkMaterial, this.darkMaterial, this.darkMaterial, this.darkMaterial, this.darkMaterial, faceMaterial];

        this.headMesh = new THREE.Mesh(headGeometry, materials);
        // We'll keep a thin wireframe for that "hologram" feel
        const headEdges = new THREE.EdgesGeometry(headGeometry);
        this.headOutline = new THREE.LineSegments(headEdges, new THREE.LineBasicMaterial({ color: this.color }));
        this.headMesh.add(this.headOutline);

        this.headMesh.position.y = 1.5;
        if (this.isLocal) this.headMesh.visible = false;
        this.mesh.add(this.headMesh);

        // 1a. Facial Features (Eyes & Mouth)
        // (featureMaterial defined above)

        // Eyes
        const eyeGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8);
        eyeGeom.rotateX(Math.PI / 2); // Point forward

        this.leftEye = new THREE.Mesh(eyeGeom, this.featureMaterial);
        this.leftEye.position.set(-0.07, headSize * 0.7, -(headDepth / 2 + 0.01));
        this.headMesh.add(this.leftEye);

        this.rightEye = new THREE.Mesh(eyeGeom, this.featureMaterial);
        this.rightEye.position.set(0.07, headSize * 0.7, -(headDepth / 2 + 0.01));
        this.headMesh.add(this.rightEye);

        // Mouth
        const mouthGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8);
        mouthGeom.rotateZ(Math.PI / 2); // Horizontal
        mouthGeom.rotateX(Math.PI / 2); // Face forward

        this.mouth = new THREE.Mesh(mouthGeom, this.featureMaterial);
        this.mouth.position.set(0, headSize * 0.3, -(headDepth / 2 + 0.01));
        this.headMesh.add(this.mouth);

        // 2. Torso (Cylinder)
        const limbRadius = 0.025;
        const cylinderGeom = new THREE.CylinderGeometry(limbRadius, limbRadius, 1, 6);
        const jointGeom = new THREE.SphereGeometry(0.04, 8, 4);

        this.torso = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        this.mesh.add(this.torso);

        // 3. Joints (Accent Color)
        this.neckJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        this.mesh.add(this.neckJoint);

        this.waistJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        this.mesh.add(this.waistJoint);

        this.leftKnee = new THREE.Mesh(jointGeom, this.accentMaterial);
        this.rightKnee = new THREE.Mesh(jointGeom, this.accentMaterial);
        this.mesh.add(this.leftKnee);
        this.mesh.add(this.rightKnee);

        this.leftShoulderJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        this.rightShoulderJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        this.leftElbowJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        this.rightElbowJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        this.mesh.add(this.leftShoulderJoint);
        this.mesh.add(this.rightShoulderJoint);
        this.mesh.add(this.leftElbowJoint);
        this.mesh.add(this.rightElbowJoint);

        // 4. Legs (Cyber Color)
        this.leftLeg = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        this.rightLeg = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        this.mesh.add(this.leftLeg);
        this.mesh.add(this.rightLeg);

        // 5. Shoulders (Cyber Color)
        this.shoulders = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        this.mesh.add(this.shoulders);

        // 6. Arms (Cyber Color)
        this.leftUpperArm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        this.leftForearm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        this.rightUpperArm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        this.rightForearm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);

        this.mesh.add(this.leftUpperArm);
        this.mesh.add(this.leftForearm);
        this.mesh.add(this.rightUpperArm);
        this.mesh.add(this.rightForearm);

        // 7. XR Hand Tracking Visuals (Accent Color)
        const handJointGeom = new THREE.SphereGeometry(0.006, 6, 4);
        const handLimbRadius = 0.003;
        const handCylinderGeom = new THREE.CylinderGeometry(handLimbRadius, handLimbRadius, 1, 4);

        this.handMeshes = { left: [], right: [] };
        this.handCylinders = { left: [], right: [] };

        // Wrist markers for fallback
        const wristGeom = new THREE.BoxGeometry(0.03, 0.03, 0.03);
        this.wristMeshes = {
            left: new THREE.Mesh(wristGeom, this.accentMaterial),
            right: new THREE.Mesh(wristGeom, this.accentMaterial)
        };
        this.mesh.add(this.wristMeshes.left);
        this.mesh.add(this.wristMeshes.right);
        this.wristMeshes.left.visible = false;
        this.wristMeshes.right.visible = false;

        for (let i = 0; i < 25; i++) {
            const leftJoint = new THREE.Mesh(handJointGeom, this.accentMaterial);
            leftJoint.visible = false;
            this.mesh.add(leftJoint);
            this.handMeshes.left.push(leftJoint);

            const rightJoint = new THREE.Mesh(handJointGeom, this.accentMaterial);
            rightJoint.visible = false;
            this.mesh.add(rightJoint);
            this.handMeshes.right.push(rightJoint);
        }

        // Hand Skeletons (Cylinders)
        for (let i = 0; i < StickFigureView.HAND_INDICES.length / 2; i++) {
            const leftCyl = new THREE.Mesh(handCylinderGeom, this.cyberMaterial);
            leftCyl.visible = false;
            this.mesh.add(leftCyl);
            this.handCylinders.left.push(leftCyl);

            const rightCyl = new THREE.Mesh(handCylinderGeom, this.cyberMaterial);
            rightCyl.visible = false;
            this.mesh.add(rightCyl);
            this.handCylinders.right.push(rightCyl);
        }

        // 7. Name Tag
        this.nameTag = null;
    }

    // ─── Main Update ─────────────────────────────────────────────────

    /**
     * Apply the entity's current state to the visuals.
     *
     * @param {Object} state
     * @param {THREE.Vector3} state.position    - Feet/root world position
     * @param {number}        state.yaw         - Body heading (radians)
     * @param {number}        state.headHeight  - Eye-level height
     * @param {THREE.Quaternion} state.headQuaternion - Head rotation relative to body
     * @param {Object}        state.handStates  - { left, right } hand tracking data
     * @param {string}        [state.name]      - Display name
     * @param {string|number} [state.color]     - Avatar accent color
     * @param {number}        [state.lerpFactor=1.0] - Interpolation weight
     * @param {number}        delta             - Frame time in seconds
     */
    update(state, delta) {
        const lerpFactor = state.lerpFactor ?? 1.0;

        // Position & rotation
        if (state.position) {
            if (lerpFactor < 1.0) {
                this.mesh.position.lerp(state.position, lerpFactor);
            } else {
                this.mesh.position.copy(state.position);
            }
        }

        if (state.yaw !== undefined) {
            if (lerpFactor < 1.0) {
                const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, state.yaw, 0, 'YXZ'));
                this.mesh.quaternion.slerp(targetQuat, lerpFactor);
            } else {
                this.mesh.rotation.y = state.yaw;
            }
        }

        // Posture
        if (state.headHeight !== undefined) {
            const height = lerpFactor < 1.0
                ? THREE.MathUtils.lerp(this.currentHeadHeight, state.headHeight, lerpFactor)
                : state.headHeight;
            this.updatePosture(height);
        }

        // Head orientation
        if (state.headQuaternion) {
            if (lerpFactor < 1.0) {
                const currentQuat = this.headMesh.quaternion.clone();
                currentQuat.slerp(state.headQuaternion, lerpFactor);
                this.headMesh.quaternion.copy(currentQuat);
            } else {
                this.headMesh.quaternion.copy(state.headQuaternion);
            }
        }

        // Hands
        if (state.handStates) {
            this.updateWristMarkers(state.handStates.left, state.handStates.right, lerpFactor);

            // Arm IK fallbacks (relaxed idle pose)
            const leftArmPos = state.handStates.left.active
                ? this.getLeftWristMarkerPosition()
                : new THREE.Vector3(-0.25, 0.7, -0.05); // Relaxed at side
            const rightArmPos = state.handStates.right.active
                ? this.getRightWristMarkerPosition()
                : new THREE.Vector3(0.25, 0.7, -0.05); // Relaxed at side
            this.updateArms(leftArmPos, rightArmPos);
        }

        // Mouth Animation (Voice-Reactive Scaling)
        if (state.audioLevel !== undefined) {
            // Apply volume to mouth scale
            // audioLevel is normalized 0-1. We scale Y (height) for an "opening" effect.
            // Minimum scale is 1 (closed/flat), Max is 5-8 range.
            const targetMouthScale = 1.0 + (state.audioLevel * 10.0);

            // Smooth the scaling to avoid flickering
            const animLerp = 0.5; // Snap faster for responsiveness
            this.mouth.scale.y = THREE.MathUtils.lerp(this.mouth.scale.y, targetMouthScale, animLerp);

            // If very quiet, snap back to default
            if (state.audioLevel < 0.05) {
                this.mouth.scale.y = 1.0;
            }
        }

        // Upright Name Tag Billboarding
        this._billboardNameTag();
        // Name
        if (state.name !== undefined && state.name !== this._lastName) {
            this._lastName = state.name;
            this.setName(state.name);
        }

        // Color
        if (state.color !== undefined && state.color !== this.color) {
            this.setColor(state.color);
        }
    }

    _billboardNameTag() {
        if (!this.nameTag) return;
        const render = gameState.managers.render;
        if (!render || !render.camera) return;

        // Get world position of camera and tag
        const cameraPos = new THREE.Vector3();
        render.camera.getWorldPosition(cameraPos);

        const tagWorldPos = new THREE.Vector3();
        this.nameTag.getWorldPosition(tagWorldPos);

        // Vector from tag to camera, but flattened on the Y plane
        const lookDir = new THREE.Vector3().subVectors(cameraPos, tagWorldPos);
        lookDir.y = 0; // This keeps it strictly upright

        if (lookDir.lengthSq() > 0.0001) {
            const target = tagWorldPos.clone().add(lookDir);
            this.nameTag.lookAt(target);
        }
    }

    /**
     * Helper to stretch a cylinder between two points.
     */
    _alignCylinder(mesh, start, end, radius = 0.02) {
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        if (len < 0.001) {
            mesh.scale.set(0, 0, 0); // Hide if too small
            return;
        }

        mesh.scale.set(1, len, 1);
        mesh.position.copy(start).addScaledVector(dir, 0.5);

        // Align cylinder (Three.js cylinders are Y-up)
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }

    // ─── Color ───────────────────────────────────────────────────────

    setColor(color) {
        this.color = color;
        const colorObj = new THREE.Color(color);
        this.accentMaterial.color.copy(colorObj);

        if (this.headOutline) this.headOutline.material.color.copy(colorObj);

        if (this.nameTag && this._lastName) {
            this.setName(this._lastName);
        }
    }

    // ─── Name Tag ────────────────────────────────────────────────────

    setName(name) {
        if (!name) {
            if (this.nameTag) {
                this.mesh.remove(this.nameTag);
                if (this.nameTag.material.map) this.nameTag.material.map.dispose();
                this.nameTag.material.dispose();
                this.nameTag = null;
            }
            return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;

        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.roundRect(0, 0, canvas.width, canvas.height, 20);
        context.fill();

        context.font = 'bold 60px Inter, Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        const fillStyle = typeof this.color === 'string' && this.color.startsWith('#')
            ? this.color
            : '#' + this.color.toString(16).padStart(6, '0');

        context.fillStyle = fillStyle;
        context.shadowColor = 'rgba(0, 0, 0, 0.8)';
        context.shadowBlur = 4;
        context.fillText(name.toUpperCase(), canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        if (this.nameTag) {
            const oldMap = this.nameTag.material.map;
            this.nameTag.material.map = texture;
            if (oldMap) oldMap.dispose();
            this.nameTag.material.needsUpdate = true;
        } else {
            // Plane Mesh instead of Sprite for controlled billboarding (upright axis)
            const geometry = new THREE.PlaneGeometry(1.0, 0.25);
            const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
            this.nameTag = new THREE.Mesh(geometry, material);
            this.mesh.add(this.nameTag);
        }

        this._updateNameTagPosition();
    }

    _updateNameTagPosition() {
        if (this.nameTag) {
            this.nameTag.position.y = this.headMesh.position.y + 0.45;
        }
    }

    // ─── Posture (Height-Driven) ─────────────────────────────────────

    updatePosture(headHeight) {
        this.currentHeadHeight = headHeight;

        const neckHeight = Math.max(0.4, headHeight - 0.2);
        this.headMesh.position.y = neckHeight;
        this.neckJoint.position.set(0, neckHeight, 0);

        const shoulderY = neckHeight - 0.1;
        const shoulderStart = new THREE.Vector3(-0.25, shoulderY, 0);
        const shoulderEnd = new THREE.Vector3(0.25, shoulderY, 0);
        this._alignCylinder(this.shoulders, shoulderStart, shoulderEnd, 0.025);

        const waistHeight = neckHeight * 0.55;
        this.waistJoint.position.set(0, waistHeight, 0);

        // Align Torso (Neck to Waist)
        this._alignCylinder(this.torso, new THREE.Vector3(0, neckHeight, 0), new THREE.Vector3(0, waistHeight, 0), 0.025);

        // Align Legs
        const leftFoot = new THREE.Vector3(-0.2, 0, 0);
        const rightFoot = new THREE.Vector3(0.2, 0, 0);
        const waistPos = new THREE.Vector3(0, waistHeight, 0);

        this._alignCylinder(this.leftLeg, waistPos, leftFoot, 0.025);
        this._alignCylinder(this.rightLeg, waistPos, rightFoot, 0.025);

        // Knee indicators
        this.leftKnee.position.lerpVectors(waistPos, leftFoot, 0.5);
        this.rightKnee.position.lerpVectors(waistPos, rightFoot, 0.5);

        this._updateNameTagPosition();
    }

    // ─── Arm IK ──────────────────────────────────────────────────────

    updateArms(leftHandPos, rightHandPos) {
        const neckHeight = Math.max(0.4, this.currentHeadHeight - 0.2);
        const shoulderY = neckHeight - 0.1;
        const leftShoulder = new THREE.Vector3(-0.25, shoulderY, 0);
        const rightShoulder = new THREE.Vector3(0.25, shoulderY, 0);

        const calculateElbow = (shoulder, hand) => {
            const armVec = new THREE.Vector3().subVectors(hand, shoulder);
            const armLen = armVec.length();
            const armDir = armVec.clone().normalize();
            const mid = new THREE.Vector3().lerpVectors(shoulder, hand, 0.5);

            const segmentLen = 0.32;
            const bendDist = Math.sqrt(Math.max(0, segmentLen * segmentLen - (armLen / 2) * (armLen / 2)));

            const side = shoulder.x > 0 ? 1 : -1;
            const hint = new THREE.Vector3(side * 0.5, -0.2, 0.2).normalize();
            const projection = hint.clone().projectOnPlane(armDir).normalize();

            return mid.addScaledVector(projection, bendDist);
        };

        const leftElbow = calculateElbow(leftShoulder, leftHandPos);
        const rightElbow = calculateElbow(rightShoulder, rightHandPos);

        // Position Joint Spheres
        this.leftShoulderJoint.position.copy(leftShoulder);
        this.rightShoulderJoint.position.copy(rightShoulder);
        this.leftElbowJoint.position.copy(leftElbow);
        this.rightElbowJoint.position.copy(rightElbow);

        // Align Volumetric Arms
        this._alignCylinder(this.leftUpperArm, leftShoulder, leftElbow, 0.02);
        this._alignCylinder(this.leftForearm, leftElbow, leftHandPos, 0.02);
        this._alignCylinder(this.rightUpperArm, rightShoulder, rightElbow, 0.02);
        this._alignCylinder(this.rightForearm, rightElbow, rightHandPos, 0.02);
    }

    // ─── Hand Tracking Visuals ───────────────────────────────────────

    updateWristMarkers(leftHandInfo, rightHandInfo, lerpFactor = 1.0) {
        const leftHasJoints = leftHandInfo.active && leftHandInfo.joints[0].position.lengthSq() > 0;
        const rightHasJoints = rightHandInfo.active && rightHandInfo.joints[0].position.lengthSq() > 0;

        if (!leftHandInfo.active || leftHasJoints) {
            this.wristMeshes.left.visible = false;
        } else {
            this.wristMeshes.left.visible = true;
            this.wristMeshes.left.position.lerp(leftHandInfo.position, lerpFactor);
            this.wristMeshes.left.quaternion.slerp(leftHandInfo.quaternion, lerpFactor);
        }

        if (!rightHandInfo.active || rightHasJoints) {
            this.wristMeshes.right.visible = false;
        } else {
            this.wristMeshes.right.visible = true;
            this.wristMeshes.right.position.lerp(rightHandInfo.position, lerpFactor);
            this.wristMeshes.right.quaternion.slerp(rightHandInfo.quaternion, lerpFactor);
        }

        this._updateHandJoints(leftHandInfo, rightHandInfo, lerpFactor);
    }

    _updateHandJoints(leftHandInfo, rightHandInfo, lerpFactor) {
        const leftHasJoints = leftHandInfo.active && leftHandInfo.joints[0].position.lengthSq() > 0;
        const rightHasJoints = rightHandInfo.active && rightHandInfo.joints[0].position.lengthSq() > 0;

        for (let i = 0; i < 25; i++) {
            if (leftHasJoints) {
                this.handMeshes.left[i].visible = true;
                this.handMeshes.left[i].position.lerp(leftHandInfo.joints[i].position, lerpFactor);
                this.handMeshes.left[i].quaternion.slerp(leftHandInfo.joints[i].quaternion, lerpFactor);
            } else {
                this.handMeshes.left[i].visible = false;
            }

            if (rightHasJoints) {
                this.handMeshes.right[i].visible = true;
                this.handMeshes.right[i].position.lerp(rightHandInfo.joints[i].position, lerpFactor);
                this.handMeshes.right[i].quaternion.slerp(rightHandInfo.joints[i].quaternion, lerpFactor);
            } else {
                this.handMeshes.right[i].visible = false;
            }
        }

        // Update Hand Skeletons (Cylinders)
        this._updateHandSkeleton('left', leftHasJoints);
        this._updateHandSkeleton('right', rightHasJoints);
    }

    _updateHandSkeleton(hand, hasJoints) {
        const cylinders = this.handCylinders[hand];
        if (!hasJoints) {
            cylinders.forEach(c => c.visible = false);
            return;
        }

        for (let i = 0; i < cylinders.length; i++) {
            const startIdx = StickFigureView.HAND_INDICES[i * 2];
            const endIdx = StickFigureView.HAND_INDICES[i * 2 + 1];
            const startJoint = this.handMeshes[hand][startIdx];
            const endJoint = this.handMeshes[hand][endIdx];

            cylinders[i].visible = true;
            this._alignCylinder(cylinders[i], startJoint.position, endJoint.position, 0.003);
        }
    }


    // ─── Accessors ───────────────────────────────────────────────────

    getLeftWristMarkerPosition() {
        return this.handMeshes.left[0].visible ? this.handMeshes.left[0].position : this.wristMeshes.left.position;
    }

    getRightWristMarkerPosition() {
        return this.handMeshes.right[0].visible ? this.handMeshes.right[0].position : this.wristMeshes.right.position;
    }

    getHeadPosition() {
        return this.headMesh.position;
    }

    getHeadQuaternion() {
        return this.headMesh.quaternion;
    }

    // ─── Cleanup ─────────────────────────────────────────────────────

    destroy() {
        this.mesh.traverse((object) => {
            if (object.isMesh || object.isLine || object.isLineSegments) {
                if (object.geometry) object.geometry.dispose();

                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(mat => mat.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            }
        });

        if (this.nameTag) {
            if (this.nameTag.material.map) this.nameTag.material.map.dispose();
            this.nameTag.material.dispose();
        }
    }
}
