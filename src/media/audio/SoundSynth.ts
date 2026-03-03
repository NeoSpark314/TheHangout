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

    public static playPadTone(
        ctx: AudioContext,
        freq: number,
        intensity: number = 0.5,
        options?: { pan?: number; distance?: number }
    ): void {
        if (!ctx) return;
        const now = ctx.currentTime;

        const distance = Math.max(0, options?.distance ?? 0);
        const pan = Math.max(-1, Math.min(1, options?.pan ?? 0));
        const distanceAtten = Math.max(0.26, 1 / (1 + distance * 0.14));
        const drive = Math.min(1.0, Math.max(0.12, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(distanceAtten, now);

        const stereo = (typeof (ctx as any).createStereoPanner === 'function')
            ? (ctx as any).createStereoPanner() as StereoPannerNode
            : null;
        if (stereo) {
            stereo.pan.setValueAtTime(pan, now);
            out.connect(stereo);
            stereo.connect(ctx.destination);
        } else {
            out.connect(ctx.destination);
        }

        const toneFilter = ctx.createBiquadFilter();
        toneFilter.type = 'lowpass';
        toneFilter.frequency.setValueAtTime(2600, now);
        toneFilter.frequency.exponentialRampToValueAtTime(650 + (drive * 350), now + 0.28);
        toneFilter.Q.setValueAtTime(0.95, now);
        toneFilter.connect(out);

        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.18 * drive, now + 0.003);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
        bodyGain.connect(toneFilter);

        const oscMain = ctx.createOscillator();
        oscMain.type = 'sawtooth';
        oscMain.frequency.setValueAtTime(freq * 0.92, now);
        oscMain.frequency.exponentialRampToValueAtTime(Math.max(48, freq * 0.48), now + 0.26);
        oscMain.connect(bodyGain);
        oscMain.start(now);
        oscMain.stop(now + 0.36);

        const oscLayer = ctx.createOscillator();
        oscLayer.type = 'square';
        oscLayer.frequency.setValueAtTime(freq * 1.5, now);
        oscLayer.frequency.exponentialRampToValueAtTime(Math.max(70, freq * 1.08), now + 0.2);
        const layerGain = ctx.createGain();
        layerGain.gain.setValueAtTime(0.0001, now);
        layerGain.gain.linearRampToValueAtTime(0.045 * drive, now + 0.003);
        layerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        oscLayer.connect(layerGain);
        layerGain.connect(toneFilter);
        oscLayer.start(now);
        oscLayer.stop(now + 0.2);

        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(freq * 0.33, now);
        sub.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.23), now + 0.32);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.0001, now);
        subGain.gain.linearRampToValueAtTime(0.16 * drive, now + 0.005);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
        sub.connect(subGain);
        subGain.connect(out);
        sub.start(now);
        sub.stop(now + 0.3);

        const click = ctx.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(Math.min(1600, freq * 4.5), now);
        click.frequency.exponentialRampToValueAtTime(Math.max(320, freq), now + 0.03);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.022 * drive, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        click.connect(clickGain);
        clickGain.connect(out);
        click.start(now);
        click.stop(now + 0.05);
    }

    public static playHighFive(
        ctx: AudioContext,
        intensity: number = 0.6,
        options?: { pan?: number; distance?: number }
    ): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const pan = Math.max(-1, Math.min(1, options?.pan ?? 0));
        const distance = Math.max(0, options?.distance ?? 0);
        const distanceAtten = Math.max(0.35, 1 / (1 + distance * 0.16));
        const drive = Math.min(1.0, Math.max(0.2, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(distanceAtten, now);

        const stereo = (typeof (ctx as any).createStereoPanner === 'function')
            ? (ctx as any).createStereoPanner() as StereoPannerNode
            : null;
        if (stereo) {
            stereo.pan.setValueAtTime(pan, now);
            out.connect(stereo);
            stereo.connect(ctx.destination);
        } else {
            out.connect(ctx.destination);
        }

        // Crash-like bright noise body.
        const noiseLen = Math.floor(ctx.sampleRate * 0.22);
        const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
        const channel = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseLen; i++) {
            channel[i] = (Math.random() * 2 - 1) * (1 - (i / noiseLen) * 0.35);
        }
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        const noiseBand = ctx.createBiquadFilter();
        noiseBand.type = 'bandpass';
        noiseBand.frequency.setValueAtTime(1700 + drive * 900, now);
        noiseBand.Q.setValueAtTime(0.7, now);
        const noiseHigh = ctx.createBiquadFilter();
        noiseHigh.type = 'highpass';
        noiseHigh.frequency.setValueAtTime(420, now);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.0001, now);
        noiseGain.gain.linearRampToValueAtTime(0.22 * drive, now + 0.004);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
        noise.connect(noiseBand);
        noiseBand.connect(noiseHigh);
        noiseHigh.connect(noiseGain);
        noiseGain.connect(out);
        noise.start(now);
        noise.stop(now + 0.21);

        // Low punch so impact has weight.
        const thump = ctx.createOscillator();
        thump.type = 'sine';
        thump.frequency.setValueAtTime(120 + drive * 20, now);
        thump.frequency.exponentialRampToValueAtTime(52, now + 0.11);
        const thumpGain = ctx.createGain();
        thumpGain.gain.setValueAtTime(0.0001, now);
        thumpGain.gain.linearRampToValueAtTime(0.16 * drive, now + 0.006);
        thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        thump.connect(thumpGain);
        thumpGain.connect(out);
        thump.start(now);
        thump.stop(now + 0.15);

        // Very short transient to preserve hand-slap articulation.
        const tick = ctx.createOscillator();
        tick.type = 'triangle';
        tick.frequency.setValueAtTime(2200, now);
        tick.frequency.exponentialRampToValueAtTime(500, now + 0.02);
        const tickGain = ctx.createGain();
        tickGain.gain.setValueAtTime(0.05 * drive, now);
        tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);
        tick.connect(tickGain);
        tickGain.connect(out);
        tick.start(now);
        tick.stop(now + 0.03);
    }
}
