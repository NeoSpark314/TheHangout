// managers/MediaManager.js
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS } from '../utils/Constants.js';

export class MediaManager {
    constructor() {
        this.localStream = null;
        this.calls = new Map(); // peerId -> mediaConnection

        // --- Audio Analysis for Mouth Animation ---
        this.audioContext = null;
        this.localSource = null;
        this.localAnalyser = null;
        this.freqData = null;

        // Listen for new connections so we can dial them if we have an active mic
        eventBus.on(EVENTS.PEER_CONNECTED, (peerId) => {
            if (this.localStream && gameState.managers.network && gameState.managers.network.peer) {
                this.callPeer(peerId);
            }
        });

        // Listen for players leaving to clean up calls
        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId) => {
            if (this.calls.has(peerId)) {
                this.calls.get(peerId).close();
                this.calls.delete(peerId);
            }
        });
    }

    /**
     * Toggles local microphone access.
     * @returns {Promise<boolean>} Resolves to true if access granted, false if stopped/failed.
     */
    async toggleMicrophone() {
        if (this.localStream) {
            // Stop voice chat
            this.stopMicrophone();
            return false;
        }

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            console.log('[MediaManager] Microphone access granted.');

            // Setup local analyser
            // Use shared context from RenderManager if available
            const render = gameState.managers.render;
            if (render && render.audioListener) {
                this.audioContext = render.audioListener.context;
            } else if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            this.localSource = this.audioContext.createMediaStreamSource(this.localStream);
            this.localAnalyser = this.audioContext.createAnalyser();
            this.localAnalyser.fftSize = 32; // Smallest for performance
            this.localSource.connect(this.localAnalyser);
            this.freqData = new Uint8Array(this.localAnalyser.frequencyBinCount);

            // Hang up any stale calls just in case
            for (const call of this.calls.values()) {
                call.close();
            }
            this.calls.clear();

            // Dial everyone currently in the room
            if (gameState.managers.network && gameState.managers.network.peer) {
                for (const peerId of gameState.managers.network.connections.keys()) {
                    this.callPeer(peerId);
                }
            }

            return true;
        } catch (err) {
            console.error('[MediaManager] Failed to get microphone:', err);
            return false;
        }
    }

    stopMicrophone() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;

            if (this.localSource) {
                this.localSource.disconnect();
                this.localSource = null;
            }
            this.localAnalyser = null;

            console.log('[MediaManager] Microphone stopped.');

            // Close all active outbound/inbound calls
            for (const call of this.calls.values()) {
                call.close();
            }
            this.calls.clear();
        }
    }

    /**
     * Binds incoming call events to the active Peer.
     * Called by NetworkManager when the peer object is created.
     */
    bindPeer(peer) {
        peer.on('call', (call) => {
            console.log(`[MediaManager] Incoming voice call from ${call.peer}`);

            // Always answer. Provide our stream if active, else just accept.
            if (this.localStream) {
                call.answer(this.localStream);
            } else {
                call.answer(); // Still receive their audio even if our mic is muted
            }

            this.setupCall(call);
        });
    }

    callPeer(targetPeerId) {
        const peer = gameState.managers.network.peer;
        if (!peer || !this.localStream) return;

        console.log(`[MediaManager] Calling ${targetPeerId} for voice chat...`);
        const call = peer.call(targetPeerId, this.localStream);
        this.setupCall(call);
    }

    setupCall(call) {
        this.calls.set(call.peer, call);

        call.on('stream', (remoteStream) => {
            console.log(`[MediaManager] Received voice stream from ${call.peer}`);
            eventBus.emit(EVENTS.VOICE_STREAM_RECEIVED, {
                peerId: call.peer,
                stream: remoteStream
            });
        });

        call.on('close', () => {
            this.calls.delete(call.peer);
        });

        call.on('error', (err) => {
            console.error(`[MediaManager] Call error with ${call.peer}:`, err);
            this.calls.delete(call.peer);
        });
    }

    /**
     * @returns {number} Normalized 0-1 volume level
     */
    getLocalVolume() {
        if (!this.localAnalyser) return 0;
        this.localAnalyser.getByteFrequencyData(this.freqData);
        let sum = 0;
        for (let i = 0; i < this.freqData.length; i++) {
            sum += this.freqData[i];
        }
        const volume = sum / this.freqData.length;
        return Math.min(1.0, volume / 128.0); // Simple thresholded normalization
    }
}
