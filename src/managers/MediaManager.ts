import { MediaConnection } from 'peerjs';
import eventBus from '../core/EventBus';
import gameState from '../core/GameState';
import { EVENTS } from '../utils/Constants';

export class MediaManager {
    private localStream: MediaStream | null = null;
    private calls: Map<string, MediaConnection> = new Map();
    private audioContext: AudioContext | null = null;
    private localSource: MediaStreamAudioSourceNode | null = null;
    private localAnalyser: AnalyserNode | null = null;
    private freqData: Uint8Array | null = null;

    constructor() {
        eventBus.on(EVENTS.PEER_CONNECTED, (peerId: string) => {
            if (this.localStream && gameState.managers.network && gameState.managers.network.peer) {
                this.callPeer(peerId);
            }
        });

        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId: string) => {
            const call = this.calls.get(peerId);
            if (call) {
                call.close();
                this.calls.delete(peerId);
            }
        });
    }

    public async toggleMicrophone(): Promise<boolean> {
        if (this.localStream) {
            this.stopMicrophone();
            return false;
        }

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            console.log('[MediaManager] Microphone access granted.');

            const render = gameState.managers.render;
            if (render && render.audioListener) {
                this.audioContext = render.audioListener.context as AudioContext;
            } else if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            }

            this.localSource = this.audioContext!.createMediaStreamSource(this.localStream);
            this.localAnalyser = this.audioContext!.createAnalyser();
            this.localAnalyser.fftSize = 32;
            this.localSource.connect(this.localAnalyser);
            this.freqData = new Uint8Array(this.localAnalyser.frequencyBinCount);

            for (const call of this.calls.values()) {
                call.close();
            }
            this.calls.clear();

            const network = gameState.managers.network;
            if (network && network.peer) {
                for (const peerId of network.connections.keys()) {
                    this.callPeer(peerId);
                }
            }

            return true;
        } catch (err) {
            console.error('[MediaManager] Failed to get microphone:', err);
            return false;
        }
    }

    public stopMicrophone(): void {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
            if (this.localSource) {
                this.localSource.disconnect();
                this.localSource = null;
            }
            this.localAnalyser = null;
            console.log('[MediaManager] Microphone stopped.');
            for (const call of this.calls.values()) {
                call.close();
            }
            this.calls.clear();
        }
    }

    public bindPeer(peer: any): void {
        peer.on('call', (call: MediaConnection) => {
            console.log(`[MediaManager] Incoming voice call from ${call.peer}`);
            if (this.localStream) {
                call.answer(this.localStream);
            } else {
                call.answer();
            }
            this.setupCall(call);
        });
    }

    public callPeer(targetPeerId: string): void {
        const network = gameState.managers.network;
        const peer = network ? network.peer : null;
        if (!peer || !this.localStream) return;

        console.log(`[MediaManager] Calling ${targetPeerId} for voice chat...`);
        const call = peer.call(targetPeerId, this.localStream);
        this.setupCall(call);
    }

    private setupCall(call: MediaConnection): void {
        this.calls.set(call.peer, call);
        call.on('stream', (remoteStream: MediaStream) => {
            console.log(`[MediaManager] Received voice stream from ${call.peer}`);
            eventBus.emit(EVENTS.VOICE_STREAM_RECEIVED, {
                peerId: call.peer,
                stream: remoteStream
            });
        });
        call.on('close', () => { this.calls.delete(call.peer); });
        call.on('error', (err: any) => {
            console.error(`[MediaManager] Call error with ${call.peer}:`, err);
            this.calls.delete(call.peer);
        });
    }

    public getLocalVolume(): number {
        if (!this.localAnalyser || !this.freqData) return 0;
        this.localAnalyser.getByteFrequencyData(this.freqData as any);
        let sum = 0;
        for (let i = 0; i < this.freqData.length; i++) {
            sum += this.freqData[i];
        }
        const volume = sum / this.freqData.length;
        return Math.min(1.0, volume / 128.0);
    }
}
