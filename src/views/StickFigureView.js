// views/StickFigureView.js

import * as THREE from 'three';
import { EntityView } from './EntityView.js';

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
        const outlineMaterial = new THREE.LineBasicMaterial({ color: this.color });
        const solidDark = new THREE.MeshBasicMaterial({ color: 0x050510, side: THREE.DoubleSide });

        // 1. Head (Box)
        const headSize = 0.3;
        const headGeometry = new THREE.BoxGeometry(headSize, headSize, headSize);
        headGeometry.translate(0, headSize / 2, 0);

        const hairMaterial = new THREE.MeshBasicMaterial({ color: 0x050510 });
        const faceMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        const materials = [hairMaterial, hairMaterial, hairMaterial, hairMaterial, hairMaterial, faceMaterial];

        this.headMesh = new THREE.Mesh(headGeometry, materials);
        const headEdges = new THREE.EdgesGeometry(headGeometry);
        const headOutline = new THREE.LineSegments(headEdges, outlineMaterial);
        this.headMesh.add(headOutline);

        this.headMesh.position.y = 1.5;
        if (this.isLocal) this.headMesh.visible = false;
        this.mesh.add(this.headMesh);

        // 2. Torso
        const torsoGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 1.5, 0),
            new THREE.Vector3(0, 0.85, 0)
        ]);
        this.torso = new THREE.Line(torsoGeom, outlineMaterial);
        this.mesh.add(this.torso);

        // 3. Legs
        const legGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.85, 0), new THREE.Vector3(-0.2, 0, 0),
            new THREE.Vector3(0, 0.85, 0), new THREE.Vector3(0.2, 0, 0)
        ]);
        this.legs = new THREE.LineSegments(legGeom, outlineMaterial);
        this.mesh.add(this.legs);

        // 4. Shoulders
        const shoulderGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.25, 0, 0), new THREE.Vector3(0.25, 0, 0)
        ]);
        this.shoulders = new THREE.Line(shoulderGeom, outlineMaterial);
        this.shoulders.position.y = 1.4;
        this.mesh.add(this.shoulders);

        // 5. Arms (updated per-frame via IK)
        this.arms = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            outlineMaterial
        );
        this.mesh.add(this.arms);

        // 6. XR Hand Tracking Visuals
        this.handMeshes = { left: [], right: [] };
        const jointGeom = new THREE.BoxGeometry(0.005, 0.005, 0.005);
        const jointMatLeft = new THREE.MeshBasicMaterial({ color: this.color });
        const jointMatRight = new THREE.MeshBasicMaterial({ color: this.color });

        const handLineMat = new THREE.LineBasicMaterial({ color: this.color });

        const leftGeom = new THREE.BufferGeometry();
        leftGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(StickFigureView.HAND_INDICES.length * 3), 3));
        const rightGeom = new THREE.BufferGeometry();
        rightGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(StickFigureView.HAND_INDICES.length * 3), 3));

        this.handLines = {
            left: new THREE.LineSegments(leftGeom, handLineMat),
            right: new THREE.LineSegments(rightGeom, handLineMat)
        };
        this.handLines.left.frustumCulled = false;
        this.handLines.right.frustumCulled = false;

        this.mesh.add(this.handLines.left);
        this.mesh.add(this.handLines.right);

        // Wrist markers for fallback
        const wristGeom = new THREE.BoxGeometry(0.02, 0.02, 0.02);
        this.wristMeshes = {
            left: new THREE.Mesh(wristGeom, jointMatLeft),
            right: new THREE.Mesh(wristGeom, jointMatRight)
        };
        this.mesh.add(this.wristMeshes.left);
        this.mesh.add(this.wristMeshes.right);
        this.wristMeshes.left.visible = false;
        this.wristMeshes.right.visible = false;

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

    // ─── Color ───────────────────────────────────────────────────────

    setColor(color) {
        this.color = color;
        const colorObj = new THREE.Color(color);

        this.mesh.traverse((child) => {
            if (child.isLine || child.isLineSegments) {
                child.material.color.copy(colorObj);
            }
            if (child.isMesh && child.geometry.type === 'BoxGeometry' && !child.name.includes('Hand')) {
                if (child === this.headMesh) {
                    child.material[5].color.copy(colorObj);
                } else if (child.name === 'wrist') {
                    child.material.color.copy(colorObj);
                }
            }
            if (child.isMesh && (child.material.name === 'jointMat' || child.geometry.type === 'BoxGeometry')) {
                if (child.material && child.material.color) child.material.color.copy(colorObj);
            }
        });

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
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
            this.nameTag = new THREE.Sprite(spriteMaterial);
            this.nameTag.scale.set(1.0, 0.25, 1.0);
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
        this.shoulders.position.y = neckHeight - 0.1;

        const waistHeight = neckHeight * 0.55;

        this.torso.geometry.setFromPoints([
            new THREE.Vector3(0, neckHeight, 0),
            new THREE.Vector3(0, waistHeight, 0)
        ]);

        this.legs.geometry.setFromPoints([
            new THREE.Vector3(0, waistHeight, 0), new THREE.Vector3(-0.2, 0, 0),
            new THREE.Vector3(0, waistHeight, 0), new THREE.Vector3(0.2, 0, 0)
        ]);

        this._updateNameTagPosition();
    }

    // ─── Arm IK ──────────────────────────────────────────────────────

    updateArms(leftHandPos, rightHandPos) {
        const neckHeight = Math.max(0.4, this.currentHeadHeight - 0.2);
        const shoulderY = neckHeight - 0.1;
        const leftShoulder = new THREE.Vector3(-0.25, shoulderY, 0);
        const rightShoulder = new THREE.Vector3(0.25, shoulderY, 0);

        const calculateElbow = (shoulder, hand) => {
            const dist = shoulder.distanceTo(hand);
            const mid = new THREE.Vector3().lerpVectors(shoulder, hand, 0.5);

            // Vector from shoulder to hand
            const armVec = new THREE.Vector3().subVectors(hand, shoulder);
            const armLen = armVec.length();
            const armDir = armVec.clone().normalize();

            // Desired bend amount (elbow point distance from the center line)
            // Using a fixed segment length heuristic (e.g. 0.45m upper arm and forearm)
            const segmentLen = 0.4;
            const bendDist = Math.sqrt(Math.max(0, segmentLen * segmentLen - (armLen / 2) * (armLen / 2)));

            // "Hint" vector to determine elbow direction (out and slightly down/back)
            const side = shoulder.x > 0 ? 1 : -1;
            const hint = new THREE.Vector3(side * 0.5, -0.2, 0.2).normalize();

            // Project hint onto the plane perpendicular to the arm direction
            const projection = hint.clone().projectOnPlane(armDir).normalize();

            return mid.addScaledVector(projection, bendDist);
        };

        const leftElbow = calculateElbow(leftShoulder, leftHandPos);
        const rightElbow = calculateElbow(rightShoulder, rightHandPos);

        const positions = new Float32Array([
            leftShoulder.x, leftShoulder.y, leftShoulder.z,
            leftElbow.x, leftElbow.y, leftElbow.z,
            leftElbow.x, leftElbow.y, leftElbow.z,
            leftHandPos.x, leftHandPos.y, leftHandPos.z,
            rightShoulder.x, rightShoulder.y, rightShoulder.z,
            rightElbow.x, rightElbow.y, rightElbow.z,
            rightElbow.x, rightElbow.y, rightElbow.z,
            rightHandPos.x, rightHandPos.y, rightHandPos.z
        ]);

        this.arms.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.arms.geometry.computeBoundingSphere();
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

        // Skeleton lines
        this._updateSkeletonLines('left', leftHasJoints);
        this._updateSkeletonLines('right', rightHasJoints);
    }

    _updateSkeletonLines(hand, hasJoints) {
        if (hasJoints) {
            const positions = this.handLines[hand].geometry.attributes.position.array;
            let ptr = 0;
            for (let i = 0; i < StickFigureView.HAND_INDICES.length; i++) {
                const jointObj = this.handMeshes[hand][StickFigureView.HAND_INDICES[i]];
                positions[ptr++] = jointObj.position.x;
                positions[ptr++] = jointObj.position.y;
                positions[ptr++] = jointObj.position.z;
            }
            this.handLines[hand].geometry.attributes.position.needsUpdate = true;
            this.handLines[hand].visible = true;
        } else {
            this.handLines[hand].visible = false;
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
