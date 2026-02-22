import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';
import { SoundSynth } from '../utils/SoundSynth.js';
import gameState from '../core/GameState.js';

export class AudioManager {
    constructor() {
        this.ctx = null;
        this.isInitialized = false;

        // Sound Recipes
        this.JOIN_FREQS = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5 (A Major)
        this.LEAVE_FREQS = [880, 659.25, 554.37, 440]; // Downward A Major

        this.setupListeners();
    }

    /**
     * Initialize AudioContext. 
     * Needs to be called within a user interaction handler.
     */
    async resume() {
        // Try to get context from Three.js listener if available
        const render = gameState.managers.render;
        if (render && render.audioListener) {
            this.ctx = render.audioListener.context;
        }

        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        if (!this.isInitialized) {
            console.log('[AudioManager] AudioContext (shared with Three.js) resumed and ready.');
            this.isInitialized = true;
            eventBus.emit(EVENTS.AUDIO_READY);
        }
    }

    setupListeners() {
        // Network Events
        eventBus.on(EVENTS.PEER_CONNECTED, () => {
            if (this.isInitialized) {
                SoundSynth.playArpeggio(this.ctx, this.JOIN_FREQS, 'square');
            }
        });

        eventBus.on(EVENTS.PEER_DISCONNECTED, () => {
            if (this.isInitialized) {
                SoundSynth.playArpeggio(this.ctx, this.LEAVE_FREQS, 'square');
            }
        });

        // Collision Events
        eventBus.on(EVENTS.ENTITY_COLLIDED, ({ intensity }) => {
            if (this.isInitialized) {
                SoundSynth.playCollision(this.ctx, intensity);
            }
        });
    }

    update(delta) {
        // Placeholder for spatial audio logic if needed later
    }
}
