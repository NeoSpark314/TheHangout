import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { SoundSynth } from './SoundSynth';
import { AppContext } from '../../app/AppContext';
import { IVector3 } from '../../shared/contracts/IMath';
import { SfxRenderCache } from './SfxRenderCache';

export type SequencerBeatType = 'kick' | 'snare' | 'hat' | 'bass';

export class AudioRuntime {
    public ctx: AudioContext | null = null;
    public isInitialized: boolean = false;

    private readonly JOIN_FREQS = [440, 554.37, 659.25, 880];
    private readonly LEAVE_FREQS = [880, 659.25, 554.37, 440];
    private readonly sfxCache = new SfxRenderCache(96);
    private readonly renderSampleRate = 32000;
    private readonly drumTimbreVersion = 3;
    private readonly beatTimbreVersion = 1;
    private readonly melodyTimbreVersion = 1;

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

    public playSequencerBeat(data: { beat: SequencerBeatType; intensity?: number; position?: IVector3 }): void {
        if (!this.isInitialized || !this.ctx) return;
        void this.playBeatBuffered(data.beat, data.intensity ?? 0.8, data.position);
    }

    public playMelodyNote(data: { frequency: number; intensity?: number; position?: IVector3 }): void {
        if (!this.isInitialized || !this.ctx) return;
        void this.playMelodyBuffered(data.frequency, data.intensity ?? 0.7, data.position);
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
                const durationSec = 0.44;
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
}
