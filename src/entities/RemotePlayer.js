// entities/RemotePlayer.js
import * as THREE from 'three';
import gameState from '../core/GameState.js';

export class RemotePlayer {
    constructor(peerId) {
        this.peerId = peerId;

        // Physical Interpolation targets
        this.targetPosition = new THREE.Vector3(0, 5, 0);
        this.targetYaw = 0;

        // XR Targets (Head & Hands)
        this.targetHead = {
            position: new THREE.Vector3(0, 0.8, 0),
            quaternion: new THREE.Quaternion()
        };

        this.targetHands = {
            left: { active: false, position: new THREE.Vector3(-0.4, 0, 0), quaternion: new THREE.Quaternion() },
            right: { active: false, position: new THREE.Vector3(0.4, 0, 0), quaternion: new THREE.Quaternion() }
        };

        this.initAvatar();
    }

    initAvatar() {
        const { render } = gameState.managers;
        if (!render) return;

        // Create root group
        this.mesh = new THREE.Group();

        // Neon Magenta Outline for Remote
        const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xff00ff });
        const solidDark = new THREE.MeshBasicMaterial({ color: 0x050510, side: THREE.DoubleSide });

        // 1. Head (Flat Square)
        const headSize = 0.4;
        const headGeometry = new THREE.PlaneGeometry(headSize, headSize);
        // Offset geometry so anchor (0,0,0) is at the bottom edge (the neck)
        headGeometry.translate(0, headSize / 2, 0);

        // For now, simple magenta filled square for remote
        this.headMesh = new THREE.Mesh(headGeometry, solidDark);
        const headEdges = new THREE.EdgesGeometry(headGeometry);
        const headOutline = new THREE.LineSegments(headEdges, outlineMaterial);
        this.headMesh.add(headOutline);
        this.headMesh.position.y = 0.6; // Position at neck height
        this.mesh.add(this.headMesh);

        // 2. Torso
        const torsoGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, -0.2, 0)
        ]);
        this.torso = new THREE.Line(torsoGeom, outlineMaterial);
        this.mesh.add(this.torso);

        // 3. Legs
        const legsSegments = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(-0.2, -1.0, 0),
            new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.2, -1.0, 0)
        ]);
        this.legs = new THREE.LineSegments(legsSegments, outlineMaterial);
        this.mesh.add(this.legs);

        // 4. Shoulders
        const shoulderGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-0.25, 0.5, 0), new THREE.Vector3(0.25, 0.5, 0)
        ]);
        this.shoulders = new THREE.Line(shoulderGeom, outlineMaterial);
        this.mesh.add(this.shoulders);

        // 5. Arms (Shoulder -> Elbow -> Wrist)
        this.arms = new THREE.LineSegments(new THREE.BufferGeometry(), outlineMaterial);
        this.mesh.add(this.arms);

        // Start somewhat high up
        this.mesh.position.copy(this.targetPosition);

        render.add(this.mesh);
        console.log(`[RemotePlayer] Created advanced stick-figure avatar for ${this.peerId}`);
    }

    setTargetState(data) {
        if (data.position) this.targetPosition.set(data.position.x, data.position.y, data.position.z);
        if (data.yaw !== undefined) this.targetYaw = data.yaw;

        if (data.head) {
            this.targetHead.position.copy(data.head.position);
            this.targetHead.quaternion.copy(data.head.quaternion);
        }

        if (data.hands) {
            if (data.hands.left) {
                this.targetHands.left.active = data.hands.left.active;
                this.targetHands.left.position.copy(data.hands.left.position);
                this.targetHands.left.quaternion.copy(data.hands.left.quaternion);
            }
            if (data.hands.right) {
                this.targetHands.right.active = data.hands.right.active;
                this.targetHands.right.position.copy(data.hands.right.position);
                this.targetHands.right.quaternion.copy(data.hands.right.quaternion);
            }
        }
    }

    update(delta) {
        if (!this.mesh) return;

        const lerpFactor = 10 * delta;

        // 1. Interpolate Body Position/Yaw
        this.mesh.position.lerp(this.targetPosition, lerpFactor);
        const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.targetYaw, 0, 'YXZ'));
        this.mesh.quaternion.slerp(targetQuaternion, lerpFactor);

        // 2. Interpolate Head
        this.headMesh.position.lerp(this.targetHead.position, lerpFactor);
        this.headMesh.quaternion.slerp(this.targetHead.quaternion, lerpFactor);

        // 3. Update Arms IK (Simple direct line from shoulder to hand target)
        // Convert world hand targets to local space for the arm lines
        const leftLocal = this.targetHands.left.position.clone();
        const rightLocal = this.targetHands.right.position.clone();

        // If not active, rest arms
        if (!this.targetHands.left.active) leftLocal.set(-0.4, 0, 0);
        if (!this.targetHands.right.active) rightLocal.set(0.4, 0, 0);

        this.updateArms(leftLocal, rightLocal);
    }

    updateArms(leftHandPos, rightHandPos) {
        const leftShoulder = new THREE.Vector3(-0.25, 0.6, 0);
        const rightShoulder = new THREE.Vector3(0.25, 0.6, 0);

        const calculateElbow = (shoulder, hand) => {
            const dist = shoulder.distanceTo(hand);
            const mid = new THREE.Vector3().lerpVectors(shoulder, hand, 0.5);

            const armDir = new THREE.Vector3().subVectors(hand, shoulder).normalize();
            const down = new THREE.Vector3(0, -1, 0);
            const side = new THREE.Vector3().crossVectors(armDir, down).normalize();

            const bendAmount = Math.max(0, 0.4 - dist * 0.5);
            const bend = new THREE.Vector3(0, -bendAmount, -bendAmount * 0.5);
            bend.addScaledVector(side, shoulder.x > 0 ? 0.1 : -0.1);

            return mid.add(bend);
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

    destroy() {
        const { render } = gameState.managers;
        if (render && this.mesh) {
            render.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }
}
