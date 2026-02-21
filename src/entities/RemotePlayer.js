import * as THREE from 'three';
import { Avatar } from './Avatar.js';
import { PlayerEntity } from './PlayerEntity.js';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class RemotePlayer extends PlayerEntity {
    constructor(peerId) {
        super(peerId, 'REMOTE_PLAYER', false);
        this.peerId = peerId;

        // Physical Interpolation targets
        this.targetPosition = new THREE.Vector3(0, 5, 0);
        this.targetYaw = 0;

        // PlayerEntity provides this.headHeight, this.headState, and this.handStates
        // We will use them as our network interpolation targets

        this.lastNetworkUpdateTime = performance.now();

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
        if (data.headHeight !== undefined) this.headHeight = data.headHeight;

        this.lastNetworkUpdateTime = performance.now();

        if (data.head) {
            if (data.head.position) this.headState.position.set(data.head.position.x, data.head.position.y, data.head.position.z);
            if (data.head.quaternion) this.headState.quaternion.set(data.head.quaternion.x, data.head.quaternion.y, data.head.quaternion.z, data.head.quaternion.w);
        }

        if (data.hands) {
            if (data.hands.left) {
                this.handStates.left.active = data.hands.left.active;
                if (data.hands.left.position) this.handStates.left.position.set(data.hands.left.position.x, data.hands.left.position.y, data.hands.left.position.z);
                if (data.hands.left.quaternion) this.handStates.left.quaternion.set(data.hands.left.quaternion.x, data.hands.left.quaternion.y, data.hands.left.quaternion.z, data.hands.left.quaternion.w);
            }
            if (data.hands.right) {
                this.handStates.right.active = data.hands.right.active;
                if (data.hands.right.position) this.handStates.right.position.set(data.hands.right.position.x, data.hands.right.position.y, data.hands.right.position.z);
                if (data.hands.right.quaternion) this.handStates.right.quaternion.set(data.hands.right.quaternion.x, data.hands.right.quaternion.y, data.hands.right.quaternion.z, data.hands.right.quaternion.w);
            }
        }
    }

    update(delta) {
        if (!this.mesh) return;

        // Timeout tracking: If no updates for 5 seconds, mark for destruction (Peer JS missed close event)
        if (performance.now() - this.lastNetworkUpdateTime > 5000) {
            console.warn(`[RemotePlayer] Player ${this.peerId} timed out. Destroying.`);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, this.peerId);
            return;
        }

        const lerpFactor = 10 * delta;

        // 1. Interpolate Body Position/Yaw
        this.mesh.position.lerp(this.targetPosition, lerpFactor);
        const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.targetYaw, 0, 'YXZ'));
        this.mesh.quaternion.slerp(targetQuaternion, lerpFactor);

        // 2. Interpolate Head & Height
        this.currentHeadHeight = THREE.MathUtils.lerp(this.currentHeadHeight || 1.7, this.headHeight, lerpFactor);
        this.avatar.updatePosture(this.currentHeadHeight);

        // Apply relative slerped head quaternion
        const currentHeadQuat = this.avatar.headMesh.quaternion.clone();
        currentHeadQuat.slerp(this.headState.quaternion, lerpFactor);
        this.avatar.updateHeadOrientation(currentHeadQuat);

        // 3. Update Arms IK
        const leftLocal = this.handStates.left.position.clone();
        const rightLocal = this.handStates.right.position.clone();

        if (!this.handStates.left.active) {
            leftLocal.set(-0.4, 0, 0);
        }
        if (!this.handStates.right.active) {
            rightLocal.set(0.4, 0, 0);
        }

        this.avatar.updateWristMarkers(this.handStates.left, this.handStates.right, lerpFactor);

        // We still need the active local position for the arm IK, 
        // the wrist markers themselves handle visual toggling.
        // We override the default local pos if active to point to the wrist marker.
        if (this.handStates.left.active) leftLocal.copy(this.avatar.getLeftWristMarkerPosition());
        if (this.handStates.right.active) rightLocal.copy(this.avatar.getRightWristMarkerPosition());

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
