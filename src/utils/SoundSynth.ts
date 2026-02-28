export class SoundSynth {
    public static playArpeggio(ctx: AudioContext, freqs: number[], type: OscillatorType = 'square', speed: number = 0.08): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        
        freqs.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = type;
            osc.frequency.setValueAtTime(freq, now + i * speed);
            
            gain.gain.setValueAtTime(0, now + i * speed);
            gain.gain.linearRampToValueAtTime(0.1, now + i * speed + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + (i + 1) * speed);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start(now + i * speed);
            osc.stop(now + (i + 1) * speed);
        });
    }

    public static playCollision(ctx: AudioContext, intensity: number): void {
        if (!ctx || intensity < 0.05) return;
        
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
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

    public static playUI(ctx: AudioContext, freq: number = 880): void {
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

    public static playPadTone(ctx: AudioContext, freq: number, intensity: number = 0.5): void {
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), now + 0.18);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3200, now);
        filter.frequency.exponentialRampToValueAtTime(700, now + 0.18);

        const vol = Math.min(0.35, Math.max(0.06, intensity * 0.18));
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.22);
    }
}
