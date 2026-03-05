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
        const drive = Math.min(1.0, Math.max(0.18, intensity));

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
        toneFilter.frequency.setValueAtTime(3200 + drive * 900, now);
        toneFilter.frequency.exponentialRampToValueAtTime(1200 + (drive * 500), now + 0.16);
        toneFilter.Q.setValueAtTime(0.72, now);
        toneFilter.connect(out);

        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.16 * drive, now + 0.005);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        bodyGain.connect(toneFilter);

        const oscMain = ctx.createOscillator();
        oscMain.type = 'sawtooth';
        oscMain.frequency.setValueAtTime(freq * 1.0, now);
        oscMain.frequency.exponentialRampToValueAtTime(Math.max(90, freq * 0.9), now + 0.11);
        oscMain.connect(bodyGain);
        oscMain.start(now);
        oscMain.stop(now + 0.24);

        const oscLayer = ctx.createOscillator();
        oscLayer.type = 'triangle';
        oscLayer.frequency.setValueAtTime(freq * 1.01, now);
        oscLayer.detune.setValueAtTime(6, now);
        const layerGain = ctx.createGain();
        layerGain.gain.setValueAtTime(0.0001, now);
        layerGain.gain.linearRampToValueAtTime(0.07 * drive, now + 0.006);
        layerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        oscLayer.connect(layerGain);
        layerGain.connect(toneFilter);
        oscLayer.start(now);
        oscLayer.stop(now + 0.22);

        // Fundamental sustain.
        const melodyFund = ctx.createOscillator();
        melodyFund.type = 'sine';
        melodyFund.frequency.setValueAtTime(freq, now);
        const melodyFundGain = ctx.createGain();
        melodyFundGain.gain.setValueAtTime(0.0001, now);
        melodyFundGain.gain.linearRampToValueAtTime(0.08 * drive, now + 0.01);
        melodyFundGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
        melodyFund.connect(melodyFundGain);
        melodyFundGain.connect(toneFilter);
        melodyFund.start(now);
        melodyFund.stop(now + 0.26);

        // Quiet fifth for synthwave chord color.
        const fifth = ctx.createOscillator();
        fifth.type = 'triangle';
        fifth.frequency.setValueAtTime(freq * 1.5, now);
        const fifthGain = ctx.createGain();
        fifthGain.gain.setValueAtTime(0.0001, now);
        fifthGain.gain.linearRampToValueAtTime(0.03 * drive, now + 0.008);
        fifthGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        fifth.connect(fifthGain);
        fifthGain.connect(toneFilter);
        fifth.start(now);
        fifth.stop(now + 0.22);

        // Keep low-end light so pads do not fight kick+bass.
        const bodyHighpass = ctx.createBiquadFilter();
        bodyHighpass.type = 'highpass';
        bodyHighpass.frequency.setValueAtTime(170, now);
        toneFilter.disconnect();
        toneFilter.connect(bodyHighpass);
        bodyHighpass.connect(out);

        const click = ctx.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(Math.min(2200, freq * 5.4), now);
        click.frequency.exponentialRampToValueAtTime(Math.max(420, freq * 1.2), now + 0.02);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.016 * drive, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);
        click.connect(clickGain);
        clickGain.connect(out);
        click.start(now);
        click.stop(now + 0.026);
    }

    public static playKick(ctx: AudioContext, intensity: number = 0.85, destination?: AudioNode): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const output = this.resolveOutput(ctx, destination);
        const drive = Math.min(1.0, Math.max(0.2, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(1.0, now);
        out.connect(output);

        const clipper = this.createSoftClipper(ctx, 1.28 + drive * 1.0);
        clipper.output.connect(out);

        const body = ctx.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(154 + drive * 20, now);
        body.frequency.exponentialRampToValueAtTime(46, now + 0.21);
        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.56 * drive, now + 0.0035);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
        body.connect(bodyGain);
        bodyGain.connect(clipper.input);
        body.start(now);
        body.stop(now + 0.25);

        const click = ctx.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(1550, now);
        click.frequency.exponentialRampToValueAtTime(260, now + 0.016);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.038 * drive, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
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
        noiseBand.frequency.setValueAtTime(2300 + drive * 760, now);
        noiseBand.Q.setValueAtTime(0.8, now);
        const noiseHigh = ctx.createBiquadFilter();
        noiseHigh.type = 'highpass';
        noiseHigh.frequency.setValueAtTime(700, now);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.0001, now);
        noiseGain.gain.linearRampToValueAtTime(0.34 * drive, now + 0.0025);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.145);
        noise.connect(noiseBand);
        noiseBand.connect(noiseHigh);
        noiseHigh.connect(noiseGain);
        noiseGain.connect(out);
        noise.start(now);
        noise.stop(now + 0.17);

        const body = ctx.createOscillator();
        body.type = 'triangle';
        body.frequency.setValueAtTime(235, now);
        body.frequency.exponentialRampToValueAtTime(145, now + 0.1);
        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.125 * drive, now + 0.003);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
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
        high.frequency.setValueAtTime(4700, now);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.setValueAtTime(7600, now);
        band.Q.setValueAtTime(1.2, now);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.102 * drive, now + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.064);
        noise.connect(high);
        high.connect(band);
        band.connect(gain);
        gain.connect(out);
        noise.start(now);
        noise.stop(now + 0.08);
    }

    public static playBass(ctx: AudioContext, intensity: number = 0.72, destination?: AudioNode): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const output = this.resolveOutput(ctx, destination);
        const drive = Math.min(1.0, Math.max(0.2, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(0.92, now);
        out.connect(output);

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(380 + drive * 180, now);
        lowpass.Q.setValueAtTime(0.8, now);
        lowpass.connect(out);

        const body = ctx.createOscillator();
        body.type = 'sawtooth';
        body.frequency.setValueAtTime(52, now);
        body.frequency.exponentialRampToValueAtTime(45, now + 0.28);
        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.linearRampToValueAtTime(0.21 * drive, now + 0.006);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        body.connect(bodyGain);
        bodyGain.connect(lowpass);
        body.start(now);
        body.stop(now + 0.32);

        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(40, now);
        sub.frequency.exponentialRampToValueAtTime(34, now + 0.31);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.0001, now);
        subGain.gain.linearRampToValueAtTime(0.28 * drive, now + 0.008);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
        sub.connect(subGain);
        subGain.connect(out);
        sub.start(now);
        sub.stop(now + 0.36);

        const click = ctx.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(340, now);
        click.frequency.exponentialRampToValueAtTime(92, now + 0.016);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.016 * drive, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);
        click.connect(clickGain);
        clickGain.connect(out);
        click.start(now);
        click.stop(now + 0.032);
    }

    public static playMelodyNote(ctx: AudioContext, frequency: number, intensity: number = 0.68, destination?: AudioNode): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const output = this.resolveOutput(ctx, destination);
        const drive = Math.min(1.0, Math.max(0.2, intensity));

        const out = ctx.createGain();
        out.gain.setValueAtTime(0.95, now);
        out.connect(output);

        const clipper = this.createSoftClipper(ctx, 1.14 + drive * 0.8);
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.setValueAtTime(4200 + drive * 1400, now);
        tone.frequency.exponentialRampToValueAtTime(1200 + drive * 360, now + 0.26);
        tone.Q.setValueAtTime(0.8, now);

        const bodyHighpass = ctx.createBiquadFilter();
        bodyHighpass.type = 'highpass';
        bodyHighpass.frequency.setValueAtTime(180, now);

        clipper.output.connect(tone);
        tone.connect(bodyHighpass);
        bodyHighpass.connect(out);

        // Very light stereo chorus for width without smearing VR positional cues.
        const chorusSend = ctx.createGain();
        chorusSend.gain.setValueAtTime(0.065, now);
        bodyHighpass.connect(chorusSend);

        const delayL = ctx.createDelay(0.03);
        const delayR = ctx.createDelay(0.03);
        delayL.delayTime.setValueAtTime(0.010, now);
        delayR.delayTime.setValueAtTime(0.015, now);

        const wetL = ctx.createGain();
        const wetR = ctx.createGain();
        wetL.gain.setValueAtTime(0.11 * drive, now);
        wetR.gain.setValueAtTime(0.1 * drive, now);

        const pannerL = (typeof (ctx as any).createStereoPanner === 'function')
            ? (ctx as any).createStereoPanner() as StereoPannerNode
            : null;
        const pannerR = (typeof (ctx as any).createStereoPanner === 'function')
            ? (ctx as any).createStereoPanner() as StereoPannerNode
            : null;
        if (pannerL) pannerL.pan.setValueAtTime(-0.45, now);
        if (pannerR) pannerR.pan.setValueAtTime(0.45, now);

        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(0.32, now);
        const lfoDepthL = ctx.createGain();
        const lfoDepthR = ctx.createGain();
        lfoDepthL.gain.setValueAtTime(0.0018, now);
        lfoDepthR.gain.setValueAtTime(-0.0016, now);
        lfo.connect(lfoDepthL);
        lfo.connect(lfoDepthR);
        lfoDepthL.connect(delayL.delayTime);
        lfoDepthR.connect(delayR.delayTime);

        chorusSend.connect(delayL);
        chorusSend.connect(delayR);
        delayL.connect(wetL);
        delayR.connect(wetR);
        if (pannerL) {
            wetL.connect(pannerL);
            pannerL.connect(out);
        } else {
            wetL.connect(out);
        }
        if (pannerR) {
            wetR.connect(pannerR);
            pannerR.connect(out);
        } else {
            wetR.connect(out);
        }
        lfo.start(now);
        lfo.stop(now + 0.62);

        const oscA = ctx.createOscillator();
        oscA.type = 'sawtooth';
        oscA.frequency.setValueAtTime(frequency, now);
        const gainA = ctx.createGain();
        gainA.gain.setValueAtTime(0.0001, now);
        gainA.gain.linearRampToValueAtTime(0.14 * drive, now + 0.008);
        gainA.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
        oscA.connect(gainA);
        gainA.connect(clipper.input);
        oscA.start(now);
        oscA.stop(now + 0.45);

        const oscB = ctx.createOscillator();
        oscB.type = 'triangle';
        oscB.frequency.setValueAtTime(frequency * 1.003, now);
        const gainB = ctx.createGain();
        gainB.gain.setValueAtTime(0.0001, now);
        gainB.gain.linearRampToValueAtTime(0.11 * drive, now + 0.01);
        gainB.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
        oscB.connect(gainB);
        gainB.connect(clipper.input);
        oscB.start(now);
        oscB.stop(now + 0.46);

        const octave = ctx.createOscillator();
        octave.type = 'sine';
        octave.frequency.setValueAtTime(frequency * 2.0, now);
        const octaveGain = ctx.createGain();
        octaveGain.gain.setValueAtTime(0.0001, now);
        octaveGain.gain.linearRampToValueAtTime(0.032 * drive, now + 0.006);
        octaveGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
        octave.connect(octaveGain);
        octaveGain.connect(tone);
        octave.start(now);
        octave.stop(now + 0.27);

        const fifth = ctx.createOscillator();
        fifth.type = 'triangle';
        fifth.frequency.setValueAtTime(frequency * 1.5, now);
        const fifthGain = ctx.createGain();
        fifthGain.gain.setValueAtTime(0.0001, now);
        fifthGain.gain.linearRampToValueAtTime(0.025 * drive, now + 0.008);
        fifthGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        fifth.connect(fifthGain);
        fifthGain.connect(tone);
        fifth.start(now);
        fifth.stop(now + 0.32);

        const click = ctx.createOscillator();
        click.type = 'triangle';
        click.frequency.setValueAtTime(Math.min(2800, frequency * 6.0), now);
        click.frequency.exponentialRampToValueAtTime(Math.max(560, frequency * 1.45), now + 0.017);
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.018 * drive, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
        click.connect(clickGain);
        clickGain.connect(out);
        click.start(now);
        click.stop(now + 0.024);
    }

    public static playArpNote(
        ctx: AudioContext,
        frequency: number,
        intensity: number = 0.62,
        brightness: number = 1.0,
        destination?: AudioNode
    ): void {
        if (!ctx) return;
        const now = ctx.currentTime;
        const output = this.resolveOutput(ctx, destination);
        const drive = Math.min(1.0, Math.max(0.2, intensity));
        const bright = Math.max(0.7, Math.min(1.4, brightness));

        const out = ctx.createGain();
        out.gain.setValueAtTime(0.9, now);
        out.connect(output);

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(300 * bright, now);
        hp.connect(out);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime((5400 + drive * 1100) * bright, now);
        lp.frequency.exponentialRampToValueAtTime((1700 + drive * 300) * bright, now + 0.26);
        lp.Q.setValueAtTime(0.7, now);
        lp.connect(hp);

        const oscA = ctx.createOscillator();
        oscA.type = 'triangle';
        oscA.frequency.setValueAtTime(frequency, now);
        const gainA = ctx.createGain();
        gainA.gain.setValueAtTime(0.0001, now);
        gainA.gain.linearRampToValueAtTime(0.1 * drive, now + 0.006);
        gainA.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
        oscA.connect(gainA);
        gainA.connect(lp);
        oscA.start(now);
        oscA.stop(now + 0.36);

        const oscB = ctx.createOscillator();
        oscB.type = 'sawtooth';
        oscB.frequency.setValueAtTime(frequency * 1.002, now);
        const gainB = ctx.createGain();
        gainB.gain.setValueAtTime(0.0001, now);
        gainB.gain.linearRampToValueAtTime(0.06 * drive, now + 0.007);
        gainB.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        oscB.connect(gainB);
        gainB.connect(lp);
        oscB.start(now);
        oscB.stop(now + 0.3);

        const shimmer = ctx.createOscillator();
        shimmer.type = 'sine';
        shimmer.frequency.setValueAtTime(frequency * 2.0, now);
        const shimmerGain = ctx.createGain();
        shimmerGain.gain.setValueAtTime(0.0001, now);
        shimmerGain.gain.linearRampToValueAtTime(0.018 * drive, now + 0.006);
        shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        shimmer.connect(shimmerGain);
        shimmerGain.connect(lp);
        shimmer.start(now);
        shimmer.stop(now + 0.2);
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
