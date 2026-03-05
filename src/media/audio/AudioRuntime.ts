import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { SoundSynth } from './SoundSynth';
import { AppContext } from '../../app/AppContext';
import { IVector3 } from '../../shared/contracts/IMath';

export class AudioRuntime {
    public ctx: AudioContext | null = null;
    public isInitialized: boolean = false;

    private readonly JOIN_FREQS = [440, 554.37, 659.25, 880];
    private readonly LEAVE_FREQS = [880, 659.25, 554.37, 440];

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
                const destination = this.createSpatialDestination(data.position);
                SoundSynth.playCollision(this.ctx, data.intensity, destination);
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
        const destination = this.createSpatialDestination(data.position);
        SoundSynth.playPadTone(this.ctx, data.frequency, data.intensity, { destination });
    }

    public playUiToggle(isActive: boolean): void {
        if (!this.isInitialized || !this.ctx) return;
        SoundSynth.playUI(this.ctx, isActive ? 1046.5 : 784);
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
}
