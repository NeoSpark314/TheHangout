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
            const deserializeHand = (netHand, localHand) => {
                localHand.active = netHand.active;
                if (netHand.position) localHand.position.set(netHand.position.x, netHand.position.y, netHand.position.z);
                if (netHand.quaternion) localHand.quaternion.set(netHand.quaternion.x, netHand.quaternion.y, netHand.quaternion.z, netHand.quaternion.w);

                if (netHand.joints && netHand.joints.length === 25) {
                    for (let i = 0; i < 25; i++) {
                        const jData = netHand.joints[i];
                        localHand.joints[i].position.set(jData.p.x, jData.p.y, jData.p.z);
                        localHand.joints[i].quaternion.set(jData.q.x, jData.q.y, jData.q.z, jData.q.w);
                    }
                } else {
                    for (let i = 0; i < 25; i++) {
                        localHand.joints[i].position.set(0, 0, 0);
                    }
                }
            };

            if (data.hands.left) deserializeHand(data.hands.left, this.handStates.left);
            if (data.hands.right) deserializeHand(data.hands.right, this.handStates.right);
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
