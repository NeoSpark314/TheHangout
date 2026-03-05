export class SoundSynth {
    private static softClipCurve: Float32Array | null = null;

    private static resolveOutput(ctx: AudioContext, destination?: AudioNode): AudioNode {
        return destination || ctx.destination;
    }

    private static getSoftClipCurve(): Float32Array {
        if (this.softClipCurve) return this.softClipCurve;
        const samples = 512;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i / (samples - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * 1.8);
        }
        this.softClipCurve = curve;
        return curve;
    }

    private static createSoftClipper(ctx: AudioContext, drive: number): { input: GainNode; output: WaveShaperNode } {
        const shaper = ctx.createWaveShaper();
        shaper.curve = this.getSoftClipCurve();
        shaper.oversample = '2x';

        const inputGain = ctx.createGain();
        inputGain.gain.value = Math.max(1.0, Math.min(2.6, drive));
        inputGain.connect(shaper);
        return { input: inputGain, output: shaper };
    }

    private static createNoiseBuffer(ctx: AudioContext, durationSec: number, taper: number = 0.0): AudioBuffer {
        const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = taper > 0 ? Math.max(0, 1 - (i / len) * taper) : 1;
            channel[i] = (Math.random() * 2 - 1) * env;
        }
        return buffer;
    }

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

    public static playCollision(ctx: AudioContext, intensity: number, destination?: AudioNode): void {
        if (!ctx || intensity < 0.05) return;
        const output = this.resolveOutput(ctx, destination);
        const now = ctx.currentTime;
        const drive = Math.min(1.0, Math.max(0.12, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(0.95, now);
        out.connect(output);

        const clipper = this.createSoftClipper(ctx, 1.15 + drive * 0.9);
        const contour = ctx.createBiquadFilter();
        contour.type = 'lowpass';
        contour.frequency.setValueAtTime(2200, now);
        contour.frequency.exponentialRampToValueAtTime(520 + (drive * 220), now + 0.2);
        contour.Q.setValueAtTime(0.8, now);
        clipper.output.connect(contour);
        contour.connect(out);

        const body = ctx.createOscillator();
        body.type = 'triangle';
        body.frequency.setValueAtTime(140 + drive * 180, now);
        body.frequency.exponentialRampToValueAtTime(52, now + 0.22);
        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.22 * drive, now + 0.004);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
        body.connect(bodyGain);
        bodyGain.connect(clipper.input);
        body.start(now);
        body.stop(now + 0.26);

        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(86 + drive * 44, now);
        sub.frequency.exponentialRampToValueAtTime(34, now + 0.28);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.0001, now);
        subGain.gain.linearRampToValueAtTime(0.26 * drive, now + 0.006);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        sub.connect(subGain);
        subGain.connect(out);
        sub.start(now);
        sub.stop(now + 0.31);

        const tick = ctx.createOscillator();
        tick.type = 'square';
        tick.frequency.setValueAtTime(1300 + (drive * 500), now);
        tick.frequency.exponentialRampToValueAtTime(280, now + 0.022);
        const tickGain = ctx.createGain();
        tickGain.gain.setValueAtTime(0.018 + drive * 0.012, now);
        tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
        tick.connect(tickGain);
        tickGain.connect(out);
        tick.start(now);
        tick.stop(now + 0.03);
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
        options?: { pan?: number; distance?: number; destination?: AudioNode }
    ): void {
        if (!ctx) return;
        const now = ctx.currentTime;

        const output = this.resolveOutput(ctx, options?.destination);
        const distance = Math.max(0, options?.distance ?? 0);
        const pan = Math.max(-1, Math.min(1, options?.pan ?? 0));
        const useFallbackStereo = !options?.destination;
        const distanceAtten = useFallbackStereo
            ? Math.max(0.26, 1 / (1 + distance * 0.14))
            : 1.0;
        const drive = Math.min(1.0, Math.max(0.12, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(distanceAtten, now);

        const stereo = useFallbackStereo && (typeof (ctx as any).createStereoPanner === 'function')
            ? (ctx as any).createStereoPanner() as StereoPannerNode
            : null;
        if (stereo) {
            stereo.pan.setValueAtTime(pan, now);
            out.connect(stereo);
            stereo.connect(output);
        } else {
            out.connect(output);
        }

        const toneFilter = ctx.createBiquadFilter();
        toneFilter.type = 'lowpass';
        toneFilter.frequency.setValueAtTime(2600, now);
        toneFilter.frequency.exponentialRampToValueAtTime(720 + (drive * 420), now + 0.3);
        toneFilter.Q.setValueAtTime(0.95, now);

        const clipper = this.createSoftClipper(ctx, 1.12 + drive * 0.95);
        const lowShelf = ctx.createBiquadFilter();
        lowShelf.type = 'lowshelf';
        lowShelf.frequency.setValueAtTime(160, now);
        lowShelf.gain.setValueAtTime(2.6 + drive * 3.4, now);
        toneFilter.connect(clipper.input);
        clipper.output.connect(lowShelf);
        lowShelf.connect(out);

        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.18 * drive, now + 0.003);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        bodyGain.connect(toneFilter);

        const oscMain = ctx.createOscillator();
        oscMain.type = 'triangle';
        oscMain.frequency.setValueAtTime(freq * 0.96, now);
        oscMain.frequency.exponentialRampToValueAtTime(Math.max(48, freq * 0.62), now + 0.22);
        oscMain.connect(bodyGain);
        oscMain.start(now);
        oscMain.stop(now + 0.31);

        const oscLayer = ctx.createOscillator();
        oscLayer.type = 'square';
        oscLayer.frequency.setValueAtTime(freq * 1.48, now);
        oscLayer.frequency.exponentialRampToValueAtTime(Math.max(70, freq * 1.02), now + 0.17);
        const layerGain = ctx.createGain();
        layerGain.gain.setValueAtTime(0.0001, now);
        layerGain.gain.linearRampToValueAtTime(0.045 * drive, now + 0.003);
        layerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        oscLayer.connect(layerGain);
        layerGain.connect(toneFilter);
        oscLayer.start(now);
        oscLayer.stop(now + 0.18);

        // Musical sustain layer so pads feel more like playable melodic keys.
        const melodyFund = ctx.createOscillator();
        melodyFund.type = 'sine';
        melodyFund.frequency.setValueAtTime(freq, now);
        const melodyFundGain = ctx.createGain();
        melodyFundGain.gain.setValueAtTime(0.0001, now);
        melodyFundGain.gain.linearRampToValueAtTime(0.12 * drive, now + 0.01);
        melodyFundGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
        melodyFund.connect(melodyFundGain);
        melodyFundGain.connect(toneFilter);
        melodyFund.start(now);
        melodyFund.stop(now + 0.58);

        const melodyHarm = ctx.createOscillator();
        melodyHarm.type = 'triangle';
        melodyHarm.frequency.setValueAtTime(freq * 2, now);
        const melodyHarmGain = ctx.createGain();
        melodyHarmGain.gain.setValueAtTime(0.0001, now);
        melodyHarmGain.gain.linearRampToValueAtTime(0.032 * drive, now + 0.008);
        melodyHarmGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
        melodyHarm.connect(melodyHarmGain);
        melodyHarmGain.connect(toneFilter);
        melodyHarm.start(now);
        melodyHarm.stop(now + 0.4);

        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(freq * 0.34, now);
        sub.frequency.exponentialRampToValueAtTime(Math.max(32, freq * 0.24), now + 0.33);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.0001, now);
        subGain.gain.linearRampToValueAtTime(0.18 * drive, now + 0.005);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
        sub.connect(subGain);
        subGain.connect(out);
        sub.start(now);
        sub.stop(now + 0.38);

        const click = ctx.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(Math.min(1800, freq * 4.9), now);
        click.frequency.exponentialRampToValueAtTime(Math.max(320, freq), now + 0.03);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.028 * drive, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        click.connect(clickGain);
        clickGain.connect(out);
        click.start(now);
        click.stop(now + 0.05);
    }

    public static playKick(ctx: AudioContext, intensity: number = 0.85, destination?: AudioNode): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const output = this.resolveOutput(ctx, destination);
        const drive = Math.min(1.0, Math.max(0.2, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(1.0, now);
        out.connect(output);

        const clipper = this.createSoftClipper(ctx, 1.2 + drive * 0.95);
        clipper.output.connect(out);

        const body = ctx.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(146 + drive * 18, now);
        body.frequency.exponentialRampToValueAtTime(42, now + 0.24);
        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.5 * drive, now + 0.004);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.27);
        body.connect(bodyGain);
        bodyGain.connect(clipper.input);
        body.start(now);
        body.stop(now + 0.28);

        const click = ctx.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(1300, now);
        click.frequency.exponentialRampToValueAtTime(240, now + 0.018);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.03 * drive, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
        click.connect(clickGain);
        clickGain.connect(out);
        click.start(now);
        click.stop(now + 0.025);
    }

    public static playSnare(ctx: AudioContext, intensity: number = 0.7, destination?: AudioNode): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const output = this.resolveOutput(ctx, destination);
        const drive = Math.min(1.0, Math.max(0.2, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(0.9, now);
        out.connect(output);

        const noise = ctx.createBufferSource();
        noise.buffer = this.createNoiseBuffer(ctx, 0.18, 0.35);
        const noiseBand = ctx.createBiquadFilter();
        noiseBand.type = 'bandpass';
        noiseBand.frequency.setValueAtTime(2100 + drive * 700, now);
        noiseBand.Q.setValueAtTime(0.8, now);
        const noiseHigh = ctx.createBiquadFilter();
        noiseHigh.type = 'highpass';
        noiseHigh.frequency.setValueAtTime(700, now);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.0001, now);
        noiseGain.gain.linearRampToValueAtTime(0.3 * drive, now + 0.003);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        noise.connect(noiseBand);
        noiseBand.connect(noiseHigh);
        noiseHigh.connect(noiseGain);
        noiseGain.connect(out);
        noise.start(now);
        noise.stop(now + 0.17);

        const body = ctx.createOscillator();
        body.type = 'triangle';
        body.frequency.setValueAtTime(220, now);
        body.frequency.exponentialRampToValueAtTime(138, now + 0.11);
        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.1 * drive, now + 0.004);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
        body.connect(bodyGain);
        bodyGain.connect(out);
        body.start(now);
        body.stop(now + 0.14);
    }

    public static playHat(ctx: AudioContext, intensity: number = 0.58, destination?: AudioNode): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const output = this.resolveOutput(ctx, destination);
        const drive = Math.min(1.0, Math.max(0.15, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(0.85, now);
        out.connect(output);

        const noise = ctx.createBufferSource();
        noise.buffer = this.createNoiseBuffer(ctx, 0.08, 0.45);
        const high = ctx.createBiquadFilter();
        high.type = 'highpass';
        high.frequency.setValueAtTime(5200, now);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.setValueAtTime(8400, now);
        band.Q.setValueAtTime(1.2, now);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.12 * drive, now + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        noise.connect(high);
        high.connect(band);
        band.connect(gain);
        gain.connect(out);
        noise.start(now);
        noise.stop(now + 0.08);
    }

    public static playHighFive(
        ctx: AudioContext,
        intensity: number = 0.6,
        options?: { pan?: number; distance?: number; destination?: AudioNode }
    ): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const output = this.resolveOutput(ctx, options?.destination);
        const pan = Math.max(-1, Math.min(1, options?.pan ?? 0));
        const distance = Math.max(0, options?.distance ?? 0);
        const useFallbackStereo = !options?.destination;
        const distanceAtten = useFallbackStereo
            ? Math.max(0.35, 1 / (1 + distance * 0.16))
            : 1.0;
        const drive = Math.min(1.0, Math.max(0.2, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(distanceAtten, now);

        const stereo = useFallbackStereo && (typeof (ctx as any).createStereoPanner === 'function')
            ? (ctx as any).createStereoPanner() as StereoPannerNode
            : null;
        if (stereo) {
            stereo.pan.setValueAtTime(pan, now);
            out.connect(stereo);
            stereo.connect(output);
        } else {
            out.connect(output);
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
