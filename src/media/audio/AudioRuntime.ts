import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { SoundSynth } from './SoundSynth';
import { AppContext } from '../../app/AppContext';
import { IVector3 } from '../../shared/contracts/IMath';
import { SfxRenderCache } from './SfxRenderCache';
import * as THREE from 'three';
import type { IAudioEmitterHandle } from '../../content/contracts/IObjectRuntimeContext';

export type SequencerBeatType = 'kick' | 'snare' | 'hat' | 'bass';

interface ICreateSpatialEmitterOptions {
    url: string;
    loop?: boolean;
    autoplay?: boolean;
    position?: IVector3;
    volume?: number;
    playbackRate?: number;
    refDistance?: number;
    maxDistance?: number;
    rolloffFactor?: number;
}

class NullAudioEmitterHandle implements IAudioEmitterHandle {
    public isReady(): boolean { return false; }
    public isPlaying(): boolean { return false; }
    public play(): void { }
    public stop(): void { }
    public setPosition(_position: IVector3): void { }
    public setVolume(_volume: number): void { }
    public setPlaybackRate(_rate: number): void { }
    public dispose(): void { }
}

class SpatialAudioEmitterHandle implements IAudioEmitterHandle {
    private disposed = false;
    private ready = false;
    private queuedPlay = false;

    constructor(
        private readonly runtime: AudioRuntime,
        private readonly anchor: THREE.Object3D,
        private readonly audio: THREE.PositionalAudio,
        private readonly options: Required<Pick<ICreateSpatialEmitterOptions, 'loop' | 'autoplay' | 'volume' | 'playbackRate'>>
    ) { }

    public async initialize(bufferPromise: Promise<AudioBuffer>): Promise<void> {
        try {
            const buffer = await bufferPromise;
            if (this.disposed) return;

            this.audio.setBuffer(buffer);
            this.audio.setLoop(this.options.loop);
            this.audio.setVolume(this.options.volume);
            this.audio.setPlaybackRate(this.options.playbackRate);
            this.ready = true;

            if (this.options.autoplay || this.queuedPlay) {
                this.play();
            }
        } catch (error) {
            console.error('[AudioRuntime] Failed to initialize spatial emitter:', error);
            this.dispose();
        }
    }

    public isReady(): boolean {
        return this.ready && !this.disposed;
    }

    public isPlaying(): boolean {
        return !this.disposed && this.audio.isPlaying;
    }

    public play(): void {
        if (this.disposed) return;
        if (!this.ready) {
            this.queuedPlay = true;
            return;
        }
        this.queuedPlay = false;
        if (this.audio.isPlaying) return;
        this.audio.play();
    }

    public stop(): void {
        this.queuedPlay = false;
        if (this.disposed || !this.audio.isPlaying) return;
        this.audio.stop();
    }

    public setPosition(position: IVector3): void {
        if (this.disposed) return;
        this.anchor.position.set(position.x, position.y, position.z);
    }

    public setVolume(volume: number): void {
        if (this.disposed) return;
        this.audio.setVolume(Math.max(0, volume));
    }

    public setPlaybackRate(rate: number): void {
        if (this.disposed) return;
        this.audio.setPlaybackRate(Math.max(0.01, rate));
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.queuedPlay = false;

        try {
            if (this.audio.isPlaying) {
                this.audio.stop();
            }
            this.audio.disconnect();
        } catch {
            // Ignore cleanup failures from partially initialized audio nodes.
        }

        this.anchor.remove(this.audio);
        this.runtime.detachEmitterAnchor(this.anchor);
    }
}

export class AudioRuntime {
    public ctx: AudioContext | null = null;
    public isInitialized: boolean = false;

    private readonly JOIN_FREQS = [440, 554.37, 659.25, 880];
    private readonly LEAVE_FREQS = [880, 659.25, 554.37, 440];
    private readonly sfxCache = new SfxRenderCache(96);
    private readonly renderSampleRate = 32000;
    private readonly drumTimbreVersion = 3;
    private readonly beatTimbreVersion = 1;
    private readonly melodyTimbreVersion = 3;
    private readonly arpTimbreVersion = 2;
    private readonly fxTimbreVersion = 1;
    private readonly audioLoader = new THREE.AudioLoader();
    private readonly sampleBufferCache = new Map<string, Promise<AudioBuffer>>();
    private readonly activeEmitterAnchors = new Set<THREE.Object3D>();

    constructor(private context: AppContext) {
        this.setupListeners();
    }

    public async resume(): Promise<void> {
        const render = this.context.runtime.render;
        if (render && render.audioListener) {
            this.ctx = render.audioListener.context as AudioContext;
        }

        if (!this.ctx) {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        if (!this.isInitialized) {
            console.log('[AudioRuntime] AudioContext resumed and ready.');
            this.isInitialized = true;
            eventBus.emit(EVENTS.AUDIO_READY);
        }
    }

    private setupListeners(): void {
        eventBus.on(EVENTS.ENTITY_DISCOVERED, () => {
            if (this.isInitialized && this.ctx) {
                SoundSynth.playArpeggio(this.ctx, this.JOIN_FREQS, 'square');
            }
        });

        eventBus.on(EVENTS.PEER_DISCONNECTED, () => {
            if (this.isInitialized && this.ctx) {
                SoundSynth.playArpeggio(this.ctx, this.LEAVE_FREQS, 'square');
            }
        });

        eventBus.on(EVENTS.ENTITY_COLLIDED, (data: { intensity: number; position?: IVector3 }) => {
            if (this.isInitialized && this.ctx) {
                void this.playCollisionBuffered(data.intensity, data.position);
            }
        });

        eventBus.on(EVENTS.SOCIAL_HIGH_FIVE, (data: { position?: IVector3; intensity: number }) => {
            if (this.isInitialized && this.ctx) {
                const destination = this.createSpatialDestination(data.position);
                SoundSynth.playHighFive(this.ctx, data.intensity, { destination });
            }
        });
    }

    public update(delta: number): void {
        // Spatial logic
    }

    public async createEmitter(options: ICreateSpatialEmitterOptions): Promise<IAudioEmitterHandle> {
        const render = this.context.runtime.render;
        const listener = render?.audioListener ?? null;
        const scene = render?.scene ?? null;
        if (!listener || !scene) {
            return new NullAudioEmitterHandle();
        }

        const anchor = new THREE.Object3D();
        anchor.name = 'SpatialAudioEmitter';
        if (options.position) {
            anchor.position.set(options.position.x, options.position.y, options.position.z);
        }
        scene.add(anchor);
        this.activeEmitterAnchors.add(anchor);

        const audio = new THREE.PositionalAudio(listener);
        audio.setRefDistance(options.refDistance ?? 1.25);
        audio.setMaxDistance(options.maxDistance ?? 32);
        audio.setRolloffFactor(options.rolloffFactor ?? 1.1);
        audio.setDistanceModel('inverse');
        anchor.add(audio);

        const handle = new SpatialAudioEmitterHandle(this, anchor, audio, {
            loop: options.loop ?? false,
            autoplay: options.autoplay ?? false,
            volume: options.volume ?? 1,
            playbackRate: options.playbackRate ?? 1
        });
        await handle.initialize(this.loadSampleBuffer(options.url));
        return handle;
    }

    /**
     * Feature-facing API for localized drum-pad feedback.
     *
     * This stays out of the global EventBus because drum pads are session-specific
     * domain logic, not an app-wide infrastructure concern.
     */
    public playDrumPadHit(data: { frequency: number; intensity: number; position?: IVector3 }): void {
        if (!this.isInitialized || !this.ctx) return;
        void this.playDrumBuffered(data.frequency, data.intensity, data.position);
    }

    public playUiToggle(isActive: boolean): void {
        if (!this.isInitialized || !this.ctx) return;
        SoundSynth.playUI(this.ctx, isActive ? 1046.5 : 784);
    }

    public playUiClick(): void {
        if (!this.isInitialized || !this.ctx) return;
        SoundSynth.playUI(this.ctx, 932.33);
    }

    public playSequencerBeat(data: { beat: SequencerBeatType; intensity?: number; position?: IVector3 }): void {
        if (!this.isInitialized || !this.ctx) return;
        void this.playBeatBuffered(data.beat, data.intensity ?? 0.8, data.position);
    }

    public playMelodyNote(data: { frequency: number; intensity?: number; position?: IVector3 }): void {
        if (!this.isInitialized || !this.ctx) return;
        void this.playMelodyBuffered(data.frequency, data.intensity ?? 0.7, data.position);
    }

    public playArpNote(data: { frequency: number; intensity?: number; brightness?: number; position?: IVector3 }): void {
        if (!this.isInitialized || !this.ctx) return;
        void this.playArpBuffered(data.frequency, data.intensity ?? 0.62, data.brightness ?? 1.0, data.position);
    }

    public playFxSweep(data: { down?: boolean; intensity?: number; position?: IVector3 }): void {
        if (!this.isInitialized || !this.ctx) return;
        void this.playFxSweepBuffered(!!data.down, data.intensity ?? 0.72, data.position);
    }

    private createSpatialDestination(position?: IVector3): AudioNode | undefined {
        if (!this.ctx) return undefined;
        if (!position) return this.ctx.destination;

        const now = this.ctx.currentTime;
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 0.8;
        panner.maxDistance = 26;
        panner.rolloffFactor = 1.25;
        panner.coneInnerAngle = 360;
        panner.coneOuterAngle = 0;
        panner.coneOuterGain = 0;
        panner.positionX.setValueAtTime(position.x, now);
        panner.positionY.setValueAtTime(position.y, now);
        panner.positionZ.setValueAtTime(position.z, now);
        panner.connect(this.ctx.destination);
        return panner;
    }

    private bucketIntensity(value: number): number {
        if (value <= 0.28) return 0.25;
        if (value <= 0.52) return 0.5;
        if (value <= 0.78) return 0.75;
        return 1.0;
    }

    private async playCollisionBuffered(intensity: number, position?: IVector3): Promise<void> {
        const runtimeCtx = this.ctx;
        if (!runtimeCtx || !this.isInitialized) return;

        const level = this.bucketIntensity(intensity);
        const key = `collision:${level.toFixed(2)}`;

        try {
            const buffer = await this.sfxCache.getOrCreate(key, async () => {
                const durationSec = 0.36;
                const frameCount = Math.max(1, Math.ceil(durationSec * this.renderSampleRate));
                const offline = new OfflineAudioContext(1, frameCount, this.renderSampleRate);
                SoundSynth.playCollision(offline as unknown as AudioContext, level);
                return offline.startRendering();
            });

            this.playSpatialBuffer(buffer, position);
        } catch (error) {
            console.error('[AudioRuntime] Collision pre-render failed:', error);
        }
    }

    private async playDrumBuffered(frequency: number, intensity: number, position?: IVector3): Promise<void> {
        const runtimeCtx = this.ctx;
        if (!runtimeCtx || !this.isInitialized) return;

        const level = this.bucketIntensity(intensity);
        const freqKey = Number.isFinite(frequency) ? frequency.toFixed(2) : '220.00';
        const key = `drum:v${this.drumTimbreVersion}:${freqKey}:${level.toFixed(2)}`;

        try {
            const buffer = await this.sfxCache.getOrCreate(key, async () => {
                const durationSec = 0.5;
                const frameCount = Math.max(1, Math.ceil(durationSec * this.renderSampleRate));
                const offline = new OfflineAudioContext(1, frameCount, this.renderSampleRate);
                SoundSynth.playPadTone(offline as unknown as AudioContext, frequency, level);
                return offline.startRendering();
            });

            this.playSpatialBuffer(buffer, position);
        } catch (error) {
            console.error('[AudioRuntime] Drum pre-render failed:', error);
        }
    }

    private async playBeatBuffered(beat: SequencerBeatType, intensity: number, position?: IVector3): Promise<void> {
        const runtimeCtx = this.ctx;
        if (!runtimeCtx || !this.isInitialized) return;

        const level = this.bucketIntensity(intensity);
        const key = `beat:v${this.beatTimbreVersion}:${beat}:${level.toFixed(2)}`;

        try {
            const buffer = await this.sfxCache.getOrCreate(key, async () => {
                const durationSec = beat === 'kick'
                    ? 0.5
                    : (beat === 'snare'
                        ? 0.32
                        : (beat === 'bass' ? 0.44 : 0.14));
                const frameCount = Math.max(1, Math.ceil(durationSec * this.renderSampleRate));
                const offline = new OfflineAudioContext(1, frameCount, this.renderSampleRate);
                switch (beat) {
                    case 'kick':
                        SoundSynth.playKick(offline as unknown as AudioContext, level);
                        break;
                    case 'snare':
                        SoundSynth.playSnare(offline as unknown as AudioContext, level);
                        break;
                    case 'hat':
                        SoundSynth.playHat(offline as unknown as AudioContext, level);
                        break;
                    case 'bass':
                        SoundSynth.playBass(offline as unknown as AudioContext, level);
                        break;
                }
                return offline.startRendering();
            });

            this.playSpatialBuffer(buffer, position);
        } catch (error) {
            console.error(`[AudioRuntime] Beat pre-render failed (${beat}):`, error);
        }
    }

    private async playMelodyBuffered(frequency: number, intensity: number, position?: IVector3): Promise<void> {
        const runtimeCtx = this.ctx;
        if (!runtimeCtx || !this.isInitialized) return;

        const level = this.bucketIntensity(intensity);
        const freqKey = Number.isFinite(frequency) ? frequency.toFixed(2) : '220.00';
        const key = `melody:v${this.melodyTimbreVersion}:${freqKey}:${level.toFixed(2)}`;

        try {
            const buffer = await this.sfxCache.getOrCreate(key, async () => {
                const durationSec = 0.66;
                const frameCount = Math.max(1, Math.ceil(durationSec * this.renderSampleRate));
                const offline = new OfflineAudioContext(1, frameCount, this.renderSampleRate);
                SoundSynth.playMelodyNote(offline as unknown as AudioContext, frequency, level);
                return offline.startRendering();
            });

            this.playSpatialBuffer(buffer, position);
        } catch (error) {
            console.error('[AudioRuntime] Melody pre-render failed:', error);
        }
    }

    private async playArpBuffered(frequency: number, intensity: number, brightness: number, position?: IVector3): Promise<void> {
        const runtimeCtx = this.ctx;
        if (!runtimeCtx || !this.isInitialized) return;

        const level = this.bucketIntensity(intensity);
        const bright = Math.max(0.7, Math.min(1.4, brightness));
        const brightKey = Math.round(bright * 10) / 10;
        const freqKey = Number.isFinite(frequency) ? frequency.toFixed(2) : '220.00';
        const key = `arp:v${this.arpTimbreVersion}:${freqKey}:${level.toFixed(2)}:b${brightKey.toFixed(1)}`;

        try {
            const buffer = await this.sfxCache.getOrCreate(key, async () => {
                const durationSec = 0.38;
                const frameCount = Math.max(1, Math.ceil(durationSec * this.renderSampleRate));
                const offline = new OfflineAudioContext(1, frameCount, this.renderSampleRate);
                SoundSynth.playArpNote(offline as unknown as AudioContext, frequency, level, brightKey);
                return offline.startRendering();
            });

            this.playSpatialBuffer(buffer, position);
        } catch (error) {
            console.error('[AudioRuntime] Arp pre-render failed:', error);
        }
    }

    private async playFxSweepBuffered(down: boolean, intensity: number, position?: IVector3): Promise<void> {
        const runtimeCtx = this.ctx;
        if (!runtimeCtx || !this.isInitialized) return;

        const level = this.bucketIntensity(intensity);
        const key = `fx:v${this.fxTimbreVersion}:${down ? 'down' : 'up'}:${level.toFixed(2)}`;

        try {
            const buffer = await this.sfxCache.getOrCreate(key, async () => {
                const durationSec = 0.64;
                const frameCount = Math.max(1, Math.ceil(durationSec * this.renderSampleRate));
                const offline = new OfflineAudioContext(1, frameCount, this.renderSampleRate);
                SoundSynth.playFxSweep(offline as unknown as AudioContext, down, level);
                return offline.startRendering();
            });

            this.playSpatialBuffer(buffer, position);
        } catch (error) {
            console.error('[AudioRuntime] FX sweep pre-render failed:', error);
        }
    }

    private playSpatialBuffer(buffer: AudioBuffer, position?: IVector3): void {
        if (!this.ctx || !this.isInitialized) return;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const destination = this.createSpatialDestination(position);
        if (!destination) return;

        source.connect(destination);
        source.start();

        source.onended = () => {
            source.disconnect();
            if (destination instanceof PannerNode) {
                destination.disconnect();
            }
        };
    }

    private loadSampleBuffer(url: string): Promise<AudioBuffer> {
        const existing = this.sampleBufferCache.get(url);
        if (existing) {
            return existing;
        }

        const promise = this.audioLoader.loadAsync(url).catch((error) => {
            this.sampleBufferCache.delete(url);
            throw error;
        });
        this.sampleBufferCache.set(url, promise);
        return promise;
    }

    public detachEmitterAnchor(anchor: THREE.Object3D): void {
        if (!this.activeEmitterAnchors.delete(anchor)) {
            return;
        }
        anchor.parent?.remove(anchor);
    }
}
