import { describe, expect, it } from 'vitest';
import { normalizeAvatarConfig } from './IAvatar';

describe('normalizeAvatarConfig', () => {
    it('preserves the coordinates render mode', () => {
        const config = normalizeAvatarConfig({
            color: '#abcdef',
            renderMode: 'coordinates'
        });

        expect(config.renderMode).toBe('coordinates');
        expect(config.color).toBe('#abcdef');
    });

    it('still falls back to stick when vrm-auto has no vrm url', () => {
        const config = normalizeAvatarConfig({
            renderMode: 'vrm-auto',
            vrmUrl: null
        });

        expect(config.renderMode).toBe('stick');
    });
});
