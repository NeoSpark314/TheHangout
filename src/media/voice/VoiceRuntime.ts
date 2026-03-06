import Peer, { MediaConnection } from 'peerjs';
import eventBus from '../../app/events/EventBus';
import { AppContext } from '../../app/AppContext';
import { IVoiceStreamReceivedEvent } from '../../shared/contracts/IVoice';
import { EVENTS, PACKET_TYPES } from '../../shared/constants/Constants';
import { AppLocalStorage } from '../../shared/storage/AppLocalStorage';

export class VoiceRuntime {
    private localStream: MediaStream | null = null;
    private calls: Map<string, MediaConnection> = new Map();
    private remoteStreams: Map<string, MediaStream> = new Map();
    private audioContext: AudioContext | null = null;
    private localSource: MediaStreamAudioSourceNode | null = null;
    private localAnalyser: AnalyserNode | null = null;
    private freqData: Uint8Array | null = null;

    // WebSocket / Dedicated Server properties
    private websocket: WebSocket | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private preferredMicDeviceId: string | null = null;

    constructor(private context: AppContext) {
        this.preferredMicDeviceId = AppLocalStorage.getPreferredMicDeviceId() || null;
        eventBus.on(EVENTS.ENTITY_DISCOVERED, (peerId: string) => {
            const network = this.context.runtime.network;
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

        eventBus.on(EVENTS.PEER_JOINED_SESSION, (peerId: string) => {
            if (this.context.isLocalServer && this.localStream && this.websocket) {
                console.log(`[VoiceRuntime] Peer ${peerId} joined. Restarting MediaRecorder to send fresh header.`);
                if (this.mediaRecorder) {
                    // Let the old one finish its last chunk then start a new one automatically
                    this.mediaRecorder.stop();
                    this.mediaRecorder = null;
                }
                this.startRecording();
            }
        });

        if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
            navigator.mediaDevices.addEventListener('devicechange', () => {
                void this.handleDeviceChange();
            });
        }
    }

    public getPreferredMicrophoneDeviceId(): string | null {
        return this.preferredMicDeviceId;
    }

    public getCurrentMicrophoneDeviceId(): string | null {
        const track = this.localStream?.getAudioTracks?.()[0];
        const settings = track?.getSettings?.();
        return settings?.deviceId || null;
    }

    public async listMicrophoneDevices(): Promise<Array<{ id: string; label: string }>> {
        if (!navigator.mediaDevices?.enumerateDevices) return [];
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices
                .filter((d) => d.kind === 'audioinput')
                .map((d, idx) => ({
                    id: d.deviceId,
                    label: d.label?.trim() || `Microphone ${idx + 1}`
                }));
        } catch {
            return [];
        }
    }

    public async setPreferredMicrophoneDevice(deviceId: string | null): Promise<boolean> {
        this.preferredMicDeviceId = deviceId && deviceId.trim().length > 0 ? deviceId : null;
        AppLocalStorage.setPreferredMicDeviceId(this.preferredMicDeviceId);

        if (!this.localStream) {
            this.syncVoiceState();
            return true;
        }

        const wasEnabled = !!this.localStream;
        if (!wasEnabled) {
            this.syncVoiceState();
            return true;
        }

        // Re-open with preferred device and rebind outbound voice path.
        this.stopMicrophone();
        return this.enableMicrophone();
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
            this.localStream = await this.acquireMicrophoneStream();
            if (!this.localStream) {
                this.syncVoiceState();
                return false;
            }
            console.log('[VoiceRuntime] Microphone access granted.');

            const render = this.context.runtime.render;
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
                const network = this.context.runtime.network;
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
            console.error('[VoiceRuntime] Failed to get microphone:', err);
            this.syncVoiceState();
            return false;
        }
    }

    private async acquireMicrophoneStream(): Promise<MediaStream | null> {
        if (!navigator.mediaDevices?.getUserMedia) return null;

        if (this.preferredMicDeviceId) {
            try {
                return await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: { exact: this.preferredMicDeviceId } },
                    video: false
                });
            } catch (err: any) {
                const name = err?.name || '';
                const canFallback = name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'AbortError';
                if (!canFallback) {
                    throw err;
                }
                console.warn('[VoiceRuntime] Preferred microphone unavailable, falling back to default input.');
                this.preferredMicDeviceId = null;
                AppLocalStorage.setPreferredMicDeviceId(null);
            }
        }

        return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }

    private async handleDeviceChange(): Promise<void> {
        const devices = await this.listMicrophoneDevices();
        const preferred = this.preferredMicDeviceId;
        if (preferred && !devices.some((d) => d.id === preferred)) {
            console.warn('[VoiceRuntime] Preferred microphone was removed. Reverting to default input.');
            this.preferredMicDeviceId = null;
            AppLocalStorage.setPreferredMicDeviceId(null);
            if (this.localStream) {
                this.stopMicrophone();
                await this.enableMicrophone();
            } else {
                this.syncVoiceState();
            }
            return;
        }

        // Keep UI selectors in sync with hotplug state even if stream is off.
        this.syncVoiceState();
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
            console.log('[VoiceRuntime] Microphone stopped.');
            for (const call of this.calls.values()) {
                call.close();
            }
            this.calls.clear();
        }
        this.syncVoiceState();
    }

    public bindPeer(peer: Peer): void {
        peer.on('call', (call: MediaConnection) => {
            console.log(`[VoiceRuntime] Incoming voice call from ${call.peer}`);
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
                console.log('[VoiceRuntime] WebSocket rebound, restarting MediaRecorder for fresh header.');
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
                        console.log(`[VoiceRuntime] Sending audio header chunk (${base64.length} chars)`);
                    }

                    const payload = JSON.stringify({
                        type: PACKET_TYPES.AUDIO_CHUNK,
                        payload: {
                            chunk: base64,
                            isHeader: isHeader
                        }
                    });
                    this.websocket.send(payload);
                    this.context.runtime.diagnostics.recordNetworkSent(payload.length);
                }
            };
            this.mediaRecorder.start(100); // 100ms chunks for lower latency
            console.log(`[VoiceRuntime] Started MediaRecorder via WebSocket chunking at 100ms`);
        } catch (err) {
            console.error('[VoiceRuntime] MediaRecorder error:', err);
        }
    }

    public callPeer(targetPeerId: string): void {
        const network = this.context.runtime.network;
        const peer = network ? network.peer : null;
        const localId = peer?.id || network?.localPeerId;
        if (!peer || !this.localStream || !network?.connections.has(targetPeerId) || targetPeerId === localId || this.calls.has(targetPeerId)) return;

        console.log(`[VoiceRuntime] Calling ${targetPeerId} for voice chat...`);
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
            console.log(`[VoiceRuntime] Received voice stream from ${call.peer}`);
            this.remoteStreams.set(call.peer, remoteStream);
            const voiceEvent: IVoiceStreamReceivedEvent = {
                peerId: call.peer,
                stream: remoteStream
            };
            eventBus.emit(EVENTS.VOICE_STREAM_RECEIVED, voiceEvent);
        });
        call.on('close', () => {
            if (this.calls.get(call.peer) === call) {
                this.calls.delete(call.peer);
            }
        });
        call.on('error', (err: any) => {
            console.error(`[VoiceRuntime] Call error with ${call.peer}:`, err);
            if (this.calls.get(call.peer) === call) {
                this.calls.delete(call.peer);
            }
        });
    }

    public getLocalVolume(): number {
        if (!this.localAnalyser || !this.freqData) return 0;
        this.localAnalyser.getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>);
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
