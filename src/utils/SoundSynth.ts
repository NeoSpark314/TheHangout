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

        const click = ctx.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(1700 + (drive * 700), now);
        click.frequency.exponentialRampToValueAtTime(340, now + 0.045);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.12 * drive, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        click.connect(clickGain);
        clickGain.connect(out);
        click.start(now);
        click.stop(now + 0.06);

        const body = ctx.createOscillator();
        body.type = 'square';
        body.frequency.setValueAtTime(420 + (drive * 160), now);
        body.frequency.exponentialRampToValueAtTime(170, now + 0.12);
        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.08 * drive, now + 0.006);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        body.connect(bodyGain);
        bodyGain.connect(out);
        body.start(now);
        body.stop(now + 0.15);
    }
}
