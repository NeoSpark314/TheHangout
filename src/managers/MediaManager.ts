import { MediaConnection } from 'peerjs';
import eventBus from '../core/EventBus';
import { GameContext } from '../core/GameState';
import { EVENTS, PACKET_TYPES } from '../utils/Constants';

export class MediaManager {
    private localStream: MediaStream | null = null;
    private calls: Map<string, MediaConnection> = new Map();
    private remoteStreams: Map<string, MediaStream> = new Map();
    private audioContext: AudioContext | null = null;
    private localSource: MediaStreamAudioSourceNode | null = null;
    private localAnalyser: AnalyserNode | null = null;
    private freqData: Uint8Array | null = null;

    // WebSocket / Local Server properties
    private websocket: WebSocket | null = null;
    private mediaRecorder: MediaRecorder | null = null;

    constructor(private context: GameContext) {
        eventBus.on(EVENTS.ENTITY_DISCOVERED, (peerId: string) => {
            const network = this.context.managers.network;
            const localId = network?.peer?.id || network?.localPeerId;
            const isRemoteNetworkPeer = !!network?.connections?.has(peerId);

            if (
                this.localStream &&
                network &&
                network.peer &&
                isRemoteNetworkPeer &&
                peerId !== localId &&
                !this.calls.has(peerId)
            ) {
                this.callPeer(peerId);
            }
        });

        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId: string) => {
            const call = this.calls.get(peerId);
            if (call) {
                call.close();
                this.calls.delete(peerId);
            }
            this.remoteStreams.delete(peerId);
        });

        eventBus.on(EVENTS.PEER_JOINED_ROOM, (peerId: string) => {
            if (this.context.isLocalServer && this.localStream && this.websocket) {
                console.log(`[MediaManager] Peer ${peerId} joined. Restarting MediaRecorder to send fresh header.`);
                if (this.mediaRecorder) {
                    // Let the old one finish its last chunk then start a new one automatically
                    this.mediaRecorder.stop();
                    this.mediaRecorder = null;
                }
                this.startRecording();
            }
        });
    }

    public async toggleMicrophone(): Promise<boolean> {
        return this.setMicrophoneEnabled(!this.localStream);
    }

    public async ensureMicrophoneEnabled(): Promise<boolean> {
        if (this.localStream) {
            this.syncVoiceState();
            return true;
        }

        return this.enableMicrophone();
    }

    public async setMicrophoneEnabled(enabled: boolean): Promise<boolean> {
        if (enabled) {
            return this.ensureMicrophoneEnabled();
        }

        this.stopMicrophone();
        return false;
    }

    public isMicrophoneEnabled(): boolean {
        return !!this.localStream;
    }

    public getRemoteStream(peerId: string): MediaStream | null {
        return this.remoteStreams.get(peerId) || null;
    }

    private async enableMicrophone(): Promise<boolean> {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            console.log('[MediaManager] Microphone access granted.');

            const render = this.context.managers.render;
            if (render && render.audioListener) {
                this.audioContext = render.audioListener.context as AudioContext;
            }

            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            }

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
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

            if (this.context.isLocalServer) {
                this.startRecording();
            } else {
                const network = this.context.managers.network;
                if (network && network.peer) {
                    for (const peerId of network.connections.keys()) {
                        if (!this.calls.has(peerId)) {
                            this.callPeer(peerId);
                        }
                    }
                }
            }

            this.syncVoiceState();
            return true;
        } catch (err) {
            console.error('[MediaManager] Failed to get microphone:', err);
            this.syncVoiceState();
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
            if (this.mediaRecorder) {
                this.mediaRecorder.stop();
                this.mediaRecorder = null;
            }
            console.log('[MediaManager] Microphone stopped.');
            for (const call of this.calls.values()) {
                call.close();
            }
            this.calls.clear();
        }
        this.syncVoiceState();
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

    public bindWebSocket(ws: WebSocket): void {
        this.websocket = ws;
        if (this.localStream) {
            if (this.mediaRecorder) {
                console.log('[MediaManager] WebSocket rebound, restarting MediaRecorder for fresh header.');
                this.mediaRecorder.stop();
                this.mediaRecorder = null;
            }
            this.startRecording();
        }
    }

    private startRecording(): void {
        if (!this.localStream || !this.websocket || this.mediaRecorder) return;

        let mimeType = 'audio/webm;codecs=opus';
        if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm';
        }

        try {
            let isFirstChunk = true;
            this.mediaRecorder = new MediaRecorder(this.localStream, { mimeType, bitsPerSecond: 16000 });
            this.mediaRecorder.ondataavailable = async (e) => {
                if (e.data.size > 0 && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    const buffer = await e.data.arrayBuffer();
                    // Blobs cannot be natively stringified via JSON. Base64 encode for transport over JSON text frame.
                    const ui8 = new Uint8Array(buffer);
                    let binaryStr = '';
                    for (let i = 0; i < ui8.byteLength; i++) {
                        binaryStr += String.fromCharCode(ui8[i]);
                    }
                    const base64 = btoa(binaryStr);
                    const isHeader = isFirstChunk;
                    isFirstChunk = false;

                    if (isHeader) {
                        console.log(`[MediaManager] Sending audio header chunk (${base64.length} chars)`);
                    }

                    this.websocket.send(JSON.stringify({
                        type: PACKET_TYPES.AUDIO_CHUNK,
                        payload: {
                            chunk: base64,
                            isHeader: isHeader
                        }
                    }));
                }
            };
            this.mediaRecorder.start(100); // 100ms chunks for lower latency
            console.log(`[MediaManager] Started MediaRecorder via WebSocket chunking at 100ms`);
        } catch (err) {
            console.error('[MediaManager] MediaRecorder error:', err);
        }
    }

    public callPeer(targetPeerId: string): void {
        const network = this.context.managers.network;
        const peer = network ? network.peer : null;
        const localId = peer?.id || network?.localPeerId;
        if (!peer || !this.localStream || !network?.connections.has(targetPeerId) || targetPeerId === localId || this.calls.has(targetPeerId)) return;

        console.log(`[MediaManager] Calling ${targetPeerId} for voice chat...`);
        const call = peer.call(targetPeerId, this.localStream);
        this.setupCall(call);
    }

    private setupCall(call: MediaConnection): void {
        const existingCall = this.calls.get(call.peer);
        if (existingCall && existingCall !== call) {
            existingCall.close();
        }
        this.calls.set(call.peer, call);
        call.on('stream', (remoteStream: MediaStream) => {
            console.log(`[MediaManager] Received voice stream from ${call.peer}`);
            this.remoteStreams.set(call.peer, remoteStream);
            eventBus.emit(EVENTS.VOICE_STREAM_RECEIVED, {
                peerId: call.peer,
                stream: remoteStream
            });
        });
        call.on('close', () => {
            if (this.calls.get(call.peer) === call) {
                this.calls.delete(call.peer);
            }
        });
        call.on('error', (err: any) => {
            console.error(`[MediaManager] Call error with ${call.peer}:`, err);
            if (this.calls.get(call.peer) === call) {
                this.calls.delete(call.peer);
            }
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

    private syncVoiceState(): void {
        const enabled = !!this.localStream;
        if (this.context.voiceEnabled !== enabled) {
            this.context.voiceEnabled = enabled;
        }
        eventBus.emit(EVENTS.VOICE_STATE_UPDATED);
    }
}
