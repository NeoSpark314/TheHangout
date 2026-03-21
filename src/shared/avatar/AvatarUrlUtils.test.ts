import { describe, expect, it } from 'vitest';
import { validateVrmUrl } from './AvatarUrlUtils';

describe('validateVrmUrl', () => {
    const baseHref = 'https://play.thehangout.app/';
    const origin = 'https://play.thehangout.app';

    it('accepts relative vrm paths', () => {
        expect(validateVrmUrl('/storage/assets/avatar.vrm', baseHref, origin)).toEqual({
            valid: true,
            error: null
        });
    });

    it('accepts https vrm urls', () => {
        expect(validateVrmUrl('https://cdn.example.com/avatar.vrm', baseHref, origin)).toEqual({
            valid: true,
            error: null
        });
    });

    it('rejects non-vrm files', () => {
        expect(validateVrmUrl('https://cdn.example.com/avatar.glb', baseHref, origin).valid).toBe(false);
    });

    it('rejects non-https cross-origin urls', () => {
        expect(validateVrmUrl('http://cdn.example.com/avatar.vrm', baseHref, origin).valid).toBe(false);
    });
});
