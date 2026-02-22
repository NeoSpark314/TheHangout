/**
 * SoundSynth.js
 * Procedural retro sound generation using Web Audio API.
 * 8-bit (Square) and 80s Synth (Triangle/Sawtooth) aesthetics.
 */
export class SoundSynth {
    /**
     * Play an upward or downward arpeggio
     * @param {AudioContext} ctx 
     * @param {number[]} freqs - Array of frequencies
     * @param {string} type - 'square', 'triangle', 'sawtooth'
     * @param {number} speed - Duration of each note
     */
    static playArpeggio(ctx, freqs, type = 'square', speed = 0.08) {
        if (!ctx) return;
        const now = ctx.currentTime;
        
        freqs.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = type;
            osc.frequency.setValueAtTime(freq, now + i * speed);
            
            // Retro "pluck" envelope
            gain.gain.setValueAtTime(0, now + i * speed);
            gain.gain.linearRampToValueAtTime(0.1, now + i * speed + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + (i + 1) * speed);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start(now + i * speed);
            osc.stop(now + (i + 1) * speed);
        });
    }

    /**
     * Play a collision sound based on intensity
     * @param {AudioContext} ctx 
     * @param {number} intensity - Normalized intensity (0 to 1)
     */
    static playCollision(ctx, intensity) {
        if (!ctx || intensity < 0.05) return;
        
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        // 80s "Tom" drum style collision
        osc.type = 'triangle';
        const startFreq = 100 + (intensity * 300);
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
        
        const volume = Math.min(intensity * 0.4, 0.6);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(now + 0.2);
    }

    /**
     * Play a sharp "click" or "clink"
     */
    static playUI(ctx, freq = 880) {
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now);
        
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(now + 0.05);
    }
}
