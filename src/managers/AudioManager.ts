import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { SoundSynth } from '../utils/SoundSynth';
import gameState from '../core/GameState';

export class AudioManager {
    public ctx: AudioContext | null = null;
    public isInitialized: boolean = false;

    private readonly JOIN_FREQS = [440, 554.37, 659.25, 880];
    private readonly LEAVE_FREQS = [880, 659.25, 554.37, 440];

    constructor() {
        this.setupListeners();
    }

    public async resume(): Promise<void> {
        const render = gameState.managers.render;
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
            console.log('[AudioManager] AudioContext resumed and ready.');
            this.isInitialized = true;
            eventBus.emit(EVENTS.AUDIO_READY);
        }
    }

    private setupListeners(): void {
        eventBus.on(EVENTS.PEER_CONNECTED, () => {
            if (this.isInitialized && this.ctx) {
                SoundSynth.playArpeggio(this.ctx, this.JOIN_FREQS, 'square');
            }
        });

        eventBus.on(EVENTS.PEER_DISCONNECTED, () => {
            if (this.isInitialized && this.ctx) {
                SoundSynth.playArpeggio(this.ctx, this.LEAVE_FREQS, 'square');
            }
        });

        eventBus.on(EVENTS.ENTITY_COLLIDED, (data: { intensity: number }) => {
            if (this.isInitialized && this.ctx) {
                SoundSynth.playCollision(this.ctx, data.intensity);
            }
        });
    }

    public update(delta: number): void {
        // Spatial logic
    }
}
