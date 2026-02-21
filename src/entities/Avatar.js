// entities/Avatar.js
import * as THREE from 'three';

export class Avatar {
    constructor({ color = 0x00ffff, isLocal = false }) {
        this.color = color;
        this.isLocal = isLocal;

        this.mesh = new THREE.Group();
        this.currentHeadHeight = 1.7;

        this.initAvatar();
    }

    // Standard WebXR hand mapping indices for drawing skeleton lines (0 is wrist)
    static HAND_INDICES = [
        0, 1, 1, 2, 2, 3, 3, 4,     // thumb
        0, 5, 5, 6, 6, 7, 7, 8, 8, 9,   // index
        0, 10, 10, 11, 11, 12, 12, 13, 13, 14,  // middle
        0, 15, 15, 16, 16, 17, 17, 18, 18, 19,  // ring
        0, 20, 20, 21, 21, 22, 22, 23, 23, 24   // pinky
    ];

    initAvatar() {
        const outlineMaterial = new THREE.LineBasicMaterial({ color: this.color });
        const solidDark = new THREE.MeshBasicMaterial({ color: 0x050510, side: THREE.DoubleSide });

        // 1. Head (Box)
        const headSize = 0.3; // 30cm box looks better
        const headGeometry = new THREE.BoxGeometry(headSize, headSize, headSize);
        // Anchor at bottom center (the neck)
        headGeometry.translate(0, headSize / 2, 0);

        const hairMaterial = new THREE.MeshBasicMaterial({ color: 0x050510 });
        const faceMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        // Box mapping: +x(0), -x(1), +y(2), -y(3), +z(4), -z(5)
        // If Avatar forward is -Z, face should be -Z (index 5)
        const materials = [hairMaterial, hairMaterial, hairMaterial, hairMaterial, hairMaterial, faceMaterial];

        this.headMesh = new THREE.Mesh(headGeometry, materials);
        const headEdges = new THREE.EdgesGeometry(headGeometry);
        const headOutline = new THREE.LineSegments(headEdges, outlineMaterial);
        this.headMesh.add(headOutline);

        this.headMesh.position.y = 1.5; // Default Neck height (1.7 eye level - 0.2)
        if (this.isLocal) this.headMesh.visible = false;
        this.mesh.add(this.headMesh);

        // 2. Torso (Vertical Line from Neck to Waist)
        const torsoGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 1.5, 0),
            new THREE.Vector3(0, 0.85, 0)
        ]);
        this.torso = new THREE.Line(torsoGeom, outlineMaterial);
        this.mesh.add(this.torso);

        // 3. Legs (Waist to floor)
        const legGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.85, 0), new THREE.Vector3(-0.2, 0, 0), // Left leg
            new THREE.Vector3(0, 0.85, 0), new THREE.Vector3(0.2, 0, 0)   // Right leg
        ]);
        this.legs = new THREE.LineSegments(legGeom, outlineMaterial);
        this.mesh.add(this.legs);

        // 4. Shoulders (Horizontal Line)
        const shoulderGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.25, 0, 0), new THREE.Vector3(0.25, 0, 0)
        ]);
        this.shoulders = new THREE.Line(shoulderGeom, outlineMaterial);
        this.shoulders.position.y = 1.4; // Slightly below neck
        this.mesh.add(this.shoulders);

        // 5. Arms (Shoulder -> Elbow -> Wrist)
        this.arms = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            outlineMaterial
        );
        this.mesh.add(this.arms);

        // 6. XR Hand Tracking Visuals
        this.handMeshes = { left: [], right: [] };
        // Shrink the joints to small knuckles
        const jointGeom = new THREE.BoxGeometry(0.005, 0.005, 0.005);
        const jointMatLeft = new THREE.MeshBasicMaterial({ color: this.color }); // Use same color
        const jointMatRight = new THREE.MeshBasicMaterial({ color: this.color });

        // Hand Skeleton Lines (24 bones * 2 vertices per bone * 3 coordinates)
        const handLineMat = new THREE.LineBasicMaterial({ color: this.color });

        const leftGeom = new THREE.BufferGeometry();
        leftGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Avatar.HAND_INDICES.length * 3), 3));
        const rightGeom = new THREE.BufferGeometry();
        rightGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Avatar.HAND_INDICES.length * 3), 3));

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

    setColor(color) {
        this.color = color;
        const colorObj = new THREE.Color(color);

        // Update Materials
        this.mesh.traverse((child) => {
            if (child.isLine || child.isLineSegments) {
                child.material.color.copy(colorObj);
            }
            if (child.isMesh && child.geometry.type === 'BoxGeometry' && !child.name.includes('Hand')) {
                // Head face material is the last one in the heads materials array
                if (child === this.headMesh) {
                    child.material[5].color.copy(colorObj);
                } else if (child.name === 'wrist') {
                    child.material.color.copy(colorObj);
                }
            }
            // Hand joints
            if (child.isMesh && (child.material.name === 'jointMat' || child.geometry.type === 'BoxGeometry')) {
                if (child.material && child.material.color) child.material.color.copy(colorObj);
            }
        });

        // Update Name Tag
        if (this.nameTag && gameState.playerName) {
            this.setName(gameState.playerName);
        }
    }

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

        // Create canvas for text
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;

        // Background (optional rounded rect)
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.roundRect(0, 0, canvas.width, canvas.height, 20);
        context.fill();

        // Text
        context.font = 'bold 60px Inter, Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        // Handle both numeric and string colors
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
            // Update existing
            const oldMap = this.nameTag.material.map;
            this.nameTag.material.map = texture;
            if (oldMap) oldMap.dispose();
            this.nameTag.material.needsUpdate = true;
        } else {
            // Create new sprite
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
            this.nameTag = new THREE.Sprite(spriteMaterial);
            this.nameTag.scale.set(1.0, 0.25, 1.0); // Aspect ratio 4:1
            this.mesh.add(this.nameTag);
        }

        this.updateNameTagPosition();
    }

    updateNameTagPosition() {
        if (this.nameTag) {
            // Position slightly above head
            this.nameTag.position.y = this.headMesh.position.y + 0.45;
        }
    }

    updatePosture(headHeight) {
        this.currentHeadHeight = headHeight;

        const neckHeight = Math.max(0.4, headHeight - 0.2);
        this.headMesh.position.y = neckHeight;
        this.shoulders.position.y = neckHeight - 0.1;

        const waistHeight = neckHeight * 0.55;

        // Update Torso Geometry
        const torsoPoints = [
            new THREE.Vector3(0, neckHeight, 0),
            new THREE.Vector3(0, waistHeight, 0)
        ];
        this.torso.geometry.setFromPoints(torsoPoints);

        // Update Legs Geometry
        const legPoints = [
            new THREE.Vector3(0, waistHeight, 0), new THREE.Vector3(-0.2, 0, 0), // Left leg
            new THREE.Vector3(0, waistHeight, 0), new THREE.Vector3(0.2, 0, 0)   // Right leg
        ];
        this.legs.geometry.setFromPoints(legPoints);

        this.updateNameTagPosition();
    }

    updateHeadOrientation(quaternion) {
        // Only orient the head if it's explicitly set. The body mesh orientation is handled explicitly by the parents.
        this.headMesh.quaternion.copy(quaternion);
    }


    updateArms(leftHandPos, rightHandPos) {
        const neckHeight = Math.max(0.4, this.currentHeadHeight - 0.2);
        const shoulderY = neckHeight - 0.1;
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

            // Bend result: downwards + slightly BACKWARDS (+Z)
            const bend = new THREE.Vector3(0, -bendAmount, bendAmount * 0.5);
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

    // Updates the generic hand representation. This is primarily for remote avatars
    // or when fine hand tracking joints are not available.
    updateWristMarkers(leftHandInfo, rightHandInfo, lerpFactor = 1.0) {
        // If they have full hand tracking active, hide generic wrists and render the joints
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

        this.updateHands(leftHandInfo, rightHandInfo, lerpFactor);
    }

    updateHands(leftHandInfo, rightHandInfo, lerpFactor) {
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

        // Update Skeleton Lines
        if (leftHasJoints) {
            const positions = this.handLines.left.geometry.attributes.position.array;
            let ptr = 0;
            for (let i = 0; i < Avatar.HAND_INDICES.length; i++) {
                const jointObj = this.handMeshes.left[Avatar.HAND_INDICES[i]];
                positions[ptr++] = jointObj.position.x;
                positions[ptr++] = jointObj.position.y;
                positions[ptr++] = jointObj.position.z;
            }
            this.handLines.left.geometry.attributes.position.needsUpdate = true;
            this.handLines.left.visible = true;
        } else {
            this.handLines.left.visible = false;
        }

        if (rightHasJoints) {
            const positions = this.handLines.right.geometry.attributes.position.array;
            let ptr = 0;
            for (let i = 0; i < Avatar.HAND_INDICES.length; i++) {
                const jointObj = this.handMeshes.right[Avatar.HAND_INDICES[i]];
                positions[ptr++] = jointObj.position.x;
                positions[ptr++] = jointObj.position.y;
                positions[ptr++] = jointObj.position.z;
            }
            this.handLines.right.geometry.attributes.position.needsUpdate = true;
            this.handLines.right.visible = true;
        } else {
            this.handLines.right.visible = false;
        }
    }

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
