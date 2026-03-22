import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_HEIGHT_M, normalizeAvatarConfig } from './IAvatar';

describe('normalizeAvatarConfig', () => {
    it('preserves the coordinates render mode', () => {
        const config = normalizeAvatarConfig({
            color: '#abcdef',
            renderMode: 'coordinates'
        });

        expect(config.renderMode).toBe('coordinates');
        expect(config.color).toBe('#abcdef');
        expect(config.playerHeightM).toBe(DEFAULT_PLAYER_HEIGHT_M);
    });

    it('still falls back to stick when vrm-auto has no vrm url', () => {
        const config = normalizeAvatarConfig({
            renderMode: 'vrm-auto',
            vrmUrl: null
        });

        expect(config.renderMode).toBe('stick');
    });

    it('clamps and preserves player height', () => {
        expect(normalizeAvatarConfig({ playerHeightM: 1.65 }).playerHeightM).toBe(1.65);
        expect(normalizeAvatarConfig({ playerHeightM: 9 }).playerHeightM).toBeLessThanOrEqual(2.3);
        expect(normalizeAvatarConfig({ playerHeightM: 0.5 }).playerHeightM).toBeGreaterThanOrEqual(1.2);
    });
});
