import * as THREE from 'three';
import { IAudioChunkPayload } from '../../../interfaces/IVoice';

export class VoiceAudioComponent {
    private positionalAudio: THREE.PositionalAudio | null = null;
    private audioAnalyser: THREE.AudioAnalyser | null = null;
    private audioElement: HTMLAudioElement | null = null;
    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
    private bufferQueue: Uint8Array[] = [];
    private manuallyMuted = false;

    constructor(
        private parent: THREE.Object3D,
        audioListener: THREE.AudioListener | null | undefined,
        private isLocal: boolean
    ) {
        if (!audioListener) return;

        this.positionalAudio = new THREE.PositionalAudio(audioListener);
        this.positionalAudio.setRefDistance(3);
        this.positionalAudio.setRolloffFactor(1.0);
        this.positionalAudio.setDistanceModel('exponential');
        this.parent.add(this.positionalAudio);
    }

    public attachVoiceStream(stream: MediaStream): void {
        if (!this.positionalAudio) return;
        try {
            if (!this.audioElement) {
                this.audioElement = new Audio();
            }
            this.applyMutedState();
            this.audioElement.srcObject = stream;
            this.audioElement.play().catch(e => console.warn('[VoiceAudioComponent] Auto-play blocked for hidden audio:', e));
            this.positionalAudio.setMediaStreamSource(stream);
            this.audioAnalyser = new THREE.AudioAnalyser(this.positionalAudio, 32);
        } catch (e) {
            console.error('[VoiceAudioComponent] Failed to set media stream source:', e);
        }
    }

    public attachAudioChunk(data: IAudioChunkPayload | string): void {
        if (!this.positionalAudio) return;

        let base64Chunk: string;
        let isHeader = false;

        if (typeof data === 'string') {
            base64Chunk = data;
        } else {
            base64Chunk = data.chunk;
            isHeader = data.isHeader;
        }

        if (isHeader && this.mediaSource) {
            console.log('[VoiceAudioComponent] New audio header received, resetting MediaSource.');
            this.cleanupAudioSource();
        }

        if (!this.mediaSource) {
            this.mediaSource = new MediaSource();
            if (!this.audioElement) {
                this.audioElement = new Audio();
                this.audioElement.autoplay = true;
            }
            this.applyMutedState();

            const blobUrl = URL.createObjectURL(this.mediaSource);
            this.audioElement.src = blobUrl;

            if (!this.audioAnalyser) {
                console.log(`[VoiceAudioComponent] Connecting AudioElement to PositionalAudio for ${this.isLocal ? 'local' : 'remote'} player`);
                this.positionalAudio.setMediaElementSource(this.audioElement as HTMLMediaElement);
                this.audioAnalyser = new THREE.AudioAnalyser(this.positionalAudio, 32);
            }

            this.mediaSource.addEventListener('sourceopen', () => {
                const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mpeg'];
                let selectedMime = '';
                for (const mime of mimeTypes) {
                    if (MediaSource.isTypeSupported(mime)) {
                        selectedMime = mime;
                        break;
                    }
                }

                if (selectedMime) {
                    console.log(`[VoiceAudioComponent] MediaSource opened. Adding SourceBuffer for: ${selectedMime}`);
                    this.sourceBuffer = this.mediaSource!.addSourceBuffer(selectedMime);
                    this.sourceBuffer.mode = 'sequence';
                    this.sourceBuffer.addEventListener('updateend', () => this.processAudioQueue());
                    this.processAudioQueue();
                } else {
                    console.error('[VoiceAudioComponent] No supported MIME type found for MediaSource');
                }
            });
        }

        try {
            const binaryStr = atob(base64Chunk);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            this.bufferQueue.push(bytes);
            if (this.sourceBuffer && !this.sourceBuffer.updating) {
                this.processAudioQueue();
            }
        } catch (e) {
            // Ignore parse error from malformed chunks.
        }
    }

    public setMuted(muted: boolean): void {
        this.manuallyMuted = muted;
        this.applyMutedState();
    }

    public getAudioLevel(): number {
        return this.audioAnalyser ? this.audioAnalyser.getAverageFrequency() / 128.0 : 0;
    }

    public destroy(): void {
        this.cleanupAudioSource();
        this.audioElement = null;

        if (this.positionalAudio) {
            try {
                if (this.positionalAudio.hasPlaybackControl) {
                    this.positionalAudio.stop();
                }
                if (this.positionalAudio.source) {
                    this.positionalAudio.disconnect();
                }
            } catch {
                // Ignore disconnect errors.
            }
            this.parent.remove(this.positionalAudio);
            this.positionalAudio = null;
        }
    }

    private cleanupAudioSource(): void {
        if (this.mediaSource) {
            if (this.mediaSource.readyState === 'open' && this.sourceBuffer) {
                try {
                    if (this.sourceBuffer.updating) {
                        this.sourceBuffer.abort();
                    }
                    this.mediaSource.removeSourceBuffer(this.sourceBuffer);
                } catch (e) {
                    console.warn('[VoiceAudioComponent] Error removing SourceBuffer:', e);
                }
            }
            this.mediaSource = null;
            this.sourceBuffer = null;
            this.bufferQueue = [];
        }

        if (this.audioElement) {
            this.audioElement.pause();
            const oldSrc = this.audioElement.src;
            this.audioElement.src = '';
            this.audioElement.removeAttribute('src');
            this.audioElement.load();
            if (oldSrc && oldSrc.startsWith('blob:')) {
                URL.revokeObjectURL(oldSrc);
            }
        }
    }

    private applyMutedState(): void {
        if (this.audioElement) {
            this.audioElement.muted = this.manuallyMuted;
        }
        if (this.positionalAudio) {
            // PositionalAudio is the audible output path for remote voice.
            this.positionalAudio.setVolume(this.manuallyMuted ? 0 : 1);
        }
    }

    private processAudioQueue(): void {
        const canAppend = this.mediaSource &&
            this.mediaSource.readyState === 'open' &&
            this.sourceBuffer &&
            !this.sourceBuffer.updating &&
            this.bufferQueue.length > 0;
        if (!canAppend) return;

        let isAttached = false;
        try {
            for (let i = 0; i < this.mediaSource!.sourceBuffers.length; i++) {
                if (this.mediaSource!.sourceBuffers[i] === this.sourceBuffer) {
                    isAttached = true;
                    break;
                }
            }
        } catch {
            isAttached = false;
        }

        if (!isAttached) {
            this.sourceBuffer = null;
            return;
        }

        const chunk = this.bufferQueue.shift()!;
        try {
            this.sourceBuffer!.appendBuffer(chunk as any);
        } catch (e) {
            console.error('[VoiceAudioComponent] Error appending buffer:', e);
            this.bufferQueue = [];
        }

        if (this.audioElement) {
            const buffered = this.audioElement.buffered;
            if (buffered.length > 0) {
                const end = buffered.end(buffered.length - 1);
                if (end - this.audioElement.currentTime > 0.5) {
                    this.audioElement.currentTime = end - 0.1;
                }
                if (this.audioElement.paused) {
                    this.audioElement.play().catch(err => {
                        console.warn('[VoiceAudioComponent] Auto-play failed:', err);
                    });
                }
            }
        }
    }
}
