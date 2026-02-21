import * as THREE from 'three';
import { Avatar } from './Avatar.js';
import { NetworkEntity } from './NetworkEntity.js';
import gameState from '../core/GameState.js';

export class RemotePlayer extends NetworkEntity {
    constructor(peerId) {
        super(peerId, 'REMOTE_PLAYER', false);
        this.peerId = peerId;

        // Physical Interpolation targets
        this.targetPosition = new THREE.Vector3(0, 5, 0);
        this.targetYaw = 0;
        this.targetNeckHeight = 0.6;

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

        this.avatar = new Avatar({ color: 0xff00ff, isLocal: false });
        this.mesh = this.avatar.mesh;

        // Start somewhat high up
        this.mesh.position.copy(this.targetPosition);

        render.add(this.mesh);

        console.log(`[RemotePlayer] Created advanced stick-figure avatar for ${this.peerId}`);
    }

    setNetworkState(data) {
        if (data.position) this.targetPosition.set(data.position.x, data.position.y, data.position.z);
        if (data.yaw !== undefined) this.targetYaw = data.yaw;
        if (data.neckHeight !== undefined) this.targetNeckHeight = data.neckHeight;

        if (data.head) {
            if (data.head.position) this.targetHead.position.set(data.head.position.x, data.head.position.y, data.head.position.z);
            if (data.head.quaternion) this.targetHead.quaternion.set(data.head.quaternion.x, data.head.quaternion.y, data.head.quaternion.z, data.head.quaternion.w);
        }

        if (data.hands) {
            if (data.hands.left) {
                this.targetHands.left.active = data.hands.left.active;
                if (data.hands.left.position) this.targetHands.left.position.set(data.hands.left.position.x, data.hands.left.position.y, data.hands.left.position.z);
                if (data.hands.left.quaternion) this.targetHands.left.quaternion.set(data.hands.left.quaternion.x, data.hands.left.quaternion.y, data.hands.left.quaternion.z, data.hands.left.quaternion.w);
            }
            if (data.hands.right) {
                this.targetHands.right.active = data.hands.right.active;
                if (data.hands.right.position) this.targetHands.right.position.set(data.hands.right.position.x, data.hands.right.position.y, data.hands.right.position.z);
                if (data.hands.right.quaternion) this.targetHands.right.quaternion.set(data.hands.right.quaternion.x, data.hands.right.quaternion.y, data.hands.right.quaternion.z, data.hands.right.quaternion.w);
            }
        }
    }

    setFace(dataURL) {
        this.avatar.setFace(dataURL);
    }

    update(delta) {
        if (!this.mesh) return;

        const lerpFactor = 10 * delta;

        // 1. Interpolate Body Position/Yaw
        this.mesh.position.lerp(this.targetPosition, lerpFactor);
        const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.targetYaw, 0, 'YXZ'));
        this.mesh.quaternion.slerp(targetQuaternion, lerpFactor);

        // 2. Interpolate Head & Height
        this.currentNeckHeight = THREE.MathUtils.lerp(this.currentNeckHeight || 0.6, this.targetNeckHeight, lerpFactor);
        this.avatar.updatePosture(this.currentNeckHeight);

        // Calculate and apply slerped head quaternion
        const currentHeadQuat = this.avatar.headMesh.quaternion.clone();
        currentHeadQuat.slerp(this.targetHead.quaternion, lerpFactor);
        this.avatar.updateHeadOrientation(currentHeadQuat);

        // 3. Update Arms IK
        const leftLocal = this.targetHands.left.position.clone();
        const rightLocal = this.targetHands.right.position.clone();

        if (!this.targetHands.left.active) {
            leftLocal.set(-0.4, 0, 0);
        }
        if (!this.targetHands.right.active) {
            rightLocal.set(0.4, 0, 0);
        }

        this.avatar.updateWristMarkers(this.targetHands.left, this.targetHands.right, lerpFactor);

        // We still need the active local position for the arm IK, 
        // the wrist markers themselves handle visual toggling.
        // We override the default local pos if active to point to the wrist marker.
        if (this.targetHands.left.active) leftLocal.copy(this.avatar.getLeftWristMarkerPosition());
        if (this.targetHands.right.active) rightLocal.copy(this.avatar.getRightWristMarkerPosition());

        this.avatar.updateArms(leftLocal, rightLocal);
    }

    destroy() {
        const { render } = gameState.managers;
        if (render && this.mesh) {
            render.remove(this.mesh);
            this.avatar.destroy();
        }
    }
}
