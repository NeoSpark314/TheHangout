import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../app/AppContext';
import { ObjectRuntimeContext } from './ObjectRuntimeContext';
import { ScenarioRuntimeContext } from './ScenarioRuntimeContext';

describe('Runtime content APIs', () => {
    it('exposes audio and particle emitters from object and scenario contexts', async () => {
        const app = new AppContext();
        const audioEmitter = { dispose: vi.fn(), isPlaying: vi.fn(), isReady: vi.fn(), play: vi.fn(), setPlaybackRate: vi.fn(), setPosition: vi.fn(), setVolume: vi.fn(), stop: vi.fn() };
        const particleEmitter = { dispose: vi.fn(), emit: vi.fn() };
        const createAudioEmitter = vi.fn(async () => audioEmitter);
        const playDrumPadHit = vi.fn();
        const createParticleEmitter = vi.fn(() => particleEmitter);
        const spawnBurst = vi.fn();

        app.setRuntime('audio', {
            createEmitter: createAudioEmitter,
            playDrumPadHit,
            playSequencerBeat: vi.fn(),
            playMelodyNote: vi.fn(),
            playArpNote: vi.fn(),
            playFxSweep: vi.fn()
        } as any);
        app.setRuntime('particles', {
            createEmitter: createParticleEmitter,
            spawnBurst
        } as any);
        app.setRuntime('assets', {
            getNormalizedModel: vi.fn(),
            loadGLTF: vi.fn(),
            loadTexture: vi.fn()
        } as any);

        const objectContext = new ObjectRuntimeContext(app, 'instance-0', 'module-0');
        const scenarioContext = new ScenarioRuntimeContext(app, {} as any);

        const audioOptions = {
            url: '/audio/test.ogg',
            loop: true,
            position: { x: 1, y: 2, z: 3 }
        };
        const particleOptions = {
            textureUrl: '/sprites/smoke.png',
            size: { min: 0.1, max: 0.2 }
        };
        const burstOptions = {
            position: { x: 0, y: 1, z: 0 },
            count: 8,
            color: new THREE.Color('white').getHex()
        };

        expect(await objectContext.audio.createEmitter(audioOptions)).toBe(audioEmitter);
        expect(await scenarioContext.audio.createEmitter(audioOptions)).toBe(audioEmitter);
        expect(objectContext.particles.createEmitter(particleOptions)).toBe(particleEmitter);
        expect(scenarioContext.particles.createEmitter(particleOptions)).toBe(particleEmitter);
        objectContext.particles.spawnBurst(burstOptions);
        scenarioContext.particles.spawnBurst(burstOptions);

        expect(createAudioEmitter).toHaveBeenCalledTimes(2);
        expect(createParticleEmitter).toHaveBeenCalledTimes(2);
        expect(spawnBurst).toHaveBeenCalledTimes(2);
        expect(playDrumPadHit).not.toHaveBeenCalled();
    });
});
