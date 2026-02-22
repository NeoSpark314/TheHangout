// entities/RemotePlayer.js

import * as THREE from 'three';
import { PlayerEntity } from './PlayerEntity.js';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

/**
 * A remote player entity — driven by network state updates.
 * Authority is always false (another client owns this).
 *
 * Rendering is delegated to this.view (typically StickFigureView).
 */
export class RemotePlayer extends PlayerEntity {
    /**
     * @param {string} peerId
     * @param {import('../views/EntityView.js').EntityView} view - Pluggable visual
     */
    constructor(peerId, view) {
        super(peerId, 'REMOTE_PLAYER', false);
        this.peerId = peerId;

        // --- Visual ---
        this.view = view;
        this.mesh = view.mesh;

        // Physical Interpolation targets
        this.targetPosition = new THREE.Vector3(0, 5, 0);
        this.targetYaw = 0;

        this.lastNetworkUpdateTime = performance.now();

        // Start somewhat high up
        this.mesh.position.copy(this.targetPosition);

        // --- Positional Audio ---
        this.positionalAudio = null;
        this.audioElement = null;

        const { render } = gameState.managers;
        if (render?.audioListener) {
            this.positionalAudio = new THREE.PositionalAudio(render.audioListener);
            this.positionalAudio.setRefDistance(3);
            this.positionalAudio.setRolloffFactor(1.0);
            this.positionalAudio.setDistanceModel('exponential');
            // Attach audio to the head so it comes from their mouth
            this.view.headMesh.add(this.positionalAudio);
        }

        this.onVoiceStream = this.onVoiceStream.bind(this);
        eventBus.on(EVENTS.VOICE_STREAM_RECEIVED, this.onVoiceStream);

        console.log(`[RemotePlayer] Created avatar for ${this.peerId}`);
    }

    onVoiceStream(data) {
        if (data.peerId === this.peerId) {
            console.log(`[RemotePlayer] Attaching voice stream to avatar ${this.peerId}`);
            if (this.positionalAudio) {
                if (this.positionalAudio.hasPlaybackControl) {
                    this.positionalAudio.stop();
                }
                try {
                    if (!this.audioElement) {
                        this.audioElement = new Audio();
                        this.audioElement.muted = true;
                    }
                    this.audioElement.srcObject = data.stream;
                    this.audioElement.play().catch(e => console.warn('[RemotePlayer] Auto-play blocked for hidden audio:', e));

                    this.positionalAudio.setMediaStreamSource(data.stream);
                } catch (e) {
                    console.error('[RemotePlayer] Failed to set media stream source:', e);
                }
            }
        }
    }

    setNetworkState(data) {
        if (data.name !== undefined && data.name !== this.name) {
            this.name = data.name;
            eventBus.emit(EVENTS.REMOTE_NAME_UPDATED, { peerId: this.peerId, name: this.name });
        }

        if (data.avatarConfig && data.avatarConfig.color !== this.avatarColor) {
            this.avatarColor = data.avatarConfig.color;
        }

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

        // Timeout tracking
        if (performance.now() - this.lastNetworkUpdateTime > 5000) {
            console.warn(`[RemotePlayer] Player ${this.peerId} timed out. Destroying.`);
            eventBus.emit(EVENTS.PEER_DISCONNECTED, this.peerId);
            return;
        }

        const lerpFactor = 10 * delta;

        // Compute head quaternion for interpolation
        const currentHeadQuat = this.view.headMesh.quaternion.clone();
        currentHeadQuat.slerp(this.headState.quaternion, lerpFactor);

        // Push state to view — view handles all interpolation and rendering
        this.view.update({
            position: this.targetPosition,
            yaw: this.targetYaw,
            headHeight: this.headHeight,
            headQuaternion: currentHeadQuat,
            handStates: this.handStates,
            name: this.name,
            color: this.avatarColor,
            lerpFactor: lerpFactor
        }, delta);
    }

    destroy() {
        super.destroy();
        eventBus.off(EVENTS.VOICE_STREAM_RECEIVED, this.onVoiceStream);

        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.srcObject = null;
            this.audioElement = null;
        }

        if (this.positionalAudio) {
            if (this.positionalAudio.hasPlaybackControl) {
                this.positionalAudio.stop();
            }
            if (this.positionalAudio.source) {
                this.positionalAudio.disconnect();
            }
            this.view.headMesh.remove(this.positionalAudio);
        }

        const { render } = gameState.managers;
        if (render && this.view) {
            this.view.removeFromScene(render.scene);
            this.view.destroy();
        }
    }
}
