// entities/Avatar.js
import * as THREE from 'three';

export class Avatar {
    constructor({ color = 0x00ffff, isLocal = false }) {
        this.color = color;
        this.isLocal = isLocal;

        this.mesh = new THREE.Group();
        this.currentNeckHeight = 0.6;

        this.initVisuals();
    }

    initVisuals() {
        const outlineMaterial = new THREE.LineBasicMaterial({ color: this.color });
        const solidDark = new THREE.MeshBasicMaterial({ color: 0x050510, side: THREE.DoubleSide });

        // 1. Head (Flat Square)
        const headSize = 0.4;
        const headGeometry = new THREE.PlaneGeometry(headSize, headSize);
        // Rotate geometry to face forward (-Z)
        headGeometry.rotateY(Math.PI);
        // Offset geometry so anchor (0,0,0) is at the bottom edge (the neck)
        headGeometry.translate(0, headSize / 2, 0);

        this.headCanvas = document.createElement('canvas');
        this.headCanvas.width = 256;
        this.headCanvas.height = 256;
        this.headCtx = this.headCanvas.getContext('2d');

        // Initial generic face
        this.headCtx.fillStyle = '#0a041c';
        this.headCtx.fillRect(0, 0, 256, 256);
        this.headCtx.strokeStyle = '#' + this.color.toString(16).padStart(6, '0');
        this.headCtx.lineWidth = 10;
        this.headCtx.strokeRect(10, 10, 236, 236);

        // Smiley Face Placeholder
        this.headCtx.beginPath();
        this.headCtx.arc(80, 80, 20, 0, Math.PI * 2);
        this.headCtx.arc(176, 80, 20, 0, Math.PI * 2);
        this.headCtx.stroke();
        this.headCtx.beginPath();
        this.headCtx.arc(128, 140, 60, 0.2, Math.PI - 0.2);
        this.headCtx.stroke();

        this.headTexture = new THREE.CanvasTexture(this.headCanvas);
        const headMaterial = new THREE.MeshBasicMaterial({ map: this.headTexture, side: THREE.DoubleSide });

        this.headMesh = new THREE.Mesh(headGeometry, headMaterial);
        const headEdges = new THREE.EdgesGeometry(headGeometry);
        const headOutline = new THREE.LineSegments(headEdges, outlineMaterial);
        this.headMesh.add(headOutline);

        this.headMesh.position.y = 0.6; // Position at neck height

        // Hide local head completely to prevent visual artifacts
        if (this.isLocal) {
            this.headMesh.visible = false;
        }

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
            new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(-0.2, -0.9, 0), // Left leg (Waist 1.0m to Floor 0m)
            new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0.2, -0.9, 0)   // Right leg
        ]);
        this.legs = new THREE.LineSegments(legGeom, outlineMaterial);
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

        // 6. XR Hand Tracking Visuals
        this.handMeshes = { left: [], right: [] };
        const jointGeom = new THREE.BoxGeometry(0.015, 0.015, 0.015);
        const jointMatLeft = new THREE.MeshBasicMaterial({ color: this.color }); // Use same color
        const jointMatRight = new THREE.MeshBasicMaterial({ color: this.color });

        // Wrist markers for fallback
        const wristGeom = new THREE.BoxGeometry(0.02, 0.02, 0.05);
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
    }

    setFace(dataURL) {
        const img = new Image();
        img.onload = () => {
            this.headCtx.clearRect(0, 0, 256, 256);
            this.headCtx.drawImage(img, 0, 0);
            this.headTexture.needsUpdate = true;
        };
        img.src = dataURL;
    }

    updatePosture(neckHeight) {
        this.currentNeckHeight = neckHeight;

        this.headMesh.position.y = neckHeight;
        this.shoulders.position.y = neckHeight - 0.1; // Shoulders 10cm below neck

        // Update Torso Geometry (Shoulder to Waist)
        const torsoPoints = [
            new THREE.Vector3(0, neckHeight, 0),
            new THREE.Vector3(0, 0.1, 0) // Waist is at 1.0m (0.1 relative to center)
        ];
        this.torso.geometry.setFromPoints(torsoPoints);
    }

    updateHeadOrientation(quaternion) {
        // Only orient the head if it's explicitly set. The body mesh orientation is handled explicitly by the parents.
        this.headMesh.quaternion.copy(quaternion);
    }

    updateHeadRotation(euler) {
        this.headMesh.rotation.copy(euler);
    }

    updateArms(leftHandPos, rightHandPos) {
        const shoulderY = this.currentNeckHeight - 0.1;
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
        if (!leftHandInfo.active) {
            this.wristMeshes.left.visible = false;
        } else {
            this.wristMeshes.left.visible = true;
            this.wristMeshes.left.position.lerp(leftHandInfo.position, lerpFactor);
            this.wristMeshes.left.quaternion.slerp(leftHandInfo.quaternion, lerpFactor);
        }

        if (!rightHandInfo.active) {
            this.wristMeshes.right.visible = false;
        } else {
            this.wristMeshes.right.visible = true;
            this.wristMeshes.right.position.lerp(rightHandInfo.position, lerpFactor);
            this.wristMeshes.right.quaternion.slerp(rightHandInfo.quaternion, lerpFactor);
        }
    }

    getLeftWristMarkerPosition() {
        return this.wristMeshes.left.position;
    }

    getRightWristMarkerPosition() {
        return this.wristMeshes.right.position;
    }

    getHeadPosition() {
        return this.headMesh.position;
    }

    getHeadQuaternion() {
        return this.headMesh.quaternion;
    }

    processXRHand(hand, handednessStr) {
        const meshes = this.handMeshes[handednessStr];
        let active = false;
        let rootPos = new THREE.Vector3();
        let rootQuat = new THREE.Quaternion();

        if (hand && hand.joints && Object.keys(hand.joints).length > 0) {
            active = true;
            let i = 0;
            for (const [jointName, jointGroup] of Object.entries(hand.joints)) {
                if (i >= 25) break;

                if (jointGroup.visible) {
                    meshes[i].visible = true;

                    const worldPos = new THREE.Vector3();
                    const worldQuat = new THREE.Quaternion();
                    jointGroup.getWorldPosition(worldPos);
                    jointGroup.getWorldQuaternion(worldQuat);

                    this.mesh.worldToLocal(worldPos);
                    meshes[i].position.copy(worldPos);
                    meshes[i].quaternion.copy(worldQuat);

                    if (jointName === 'wrist') {
                        rootPos.copy(worldPos);
                        rootQuat.copy(worldQuat);
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
        return { active, rootPos, rootQuat };
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

        if (this.headTexture) this.headTexture.dispose();
    }
}
