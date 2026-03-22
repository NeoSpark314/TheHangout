import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_HEIGHT_M } from '../contracts/IAvatar';
import {
    DEFAULT_STANDING_EYE_HEIGHT_RATIO,
    estimateStandingEyeHeightM,
    getAvatarBodyHeightM,
    getAvatarBodyScale
} from './AvatarMetrics';

describe('AvatarMetrics', () => {
    it('derives standing eye height from configured player height', () => {
        expect(estimateStandingEyeHeightM(1.8)).toBeCloseTo(1.8 * DEFAULT_STANDING_EYE_HEIGHT_RATIO);
    });

    it('clamps invalid player height before deriving metrics', () => {
        expect(getAvatarBodyHeightM(undefined)).toBe(DEFAULT_PLAYER_HEIGHT_M);
        expect(getAvatarBodyScale(undefined)).toBe(1);
    });
});
