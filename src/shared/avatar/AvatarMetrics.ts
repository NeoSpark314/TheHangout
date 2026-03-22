import { clampPlayerHeightM, DEFAULT_PLAYER_HEIGHT_M } from '../contracts/IAvatar';

export const DEFAULT_STANDING_EYE_HEIGHT_RATIO = 0.935;

export function getAvatarBodyHeightM(playerHeightM?: number | null): number {
    return clampPlayerHeightM(playerHeightM);
}

export function estimateStandingEyeHeightM(playerHeightM?: number | null): number {
    return getAvatarBodyHeightM(playerHeightM) * DEFAULT_STANDING_EYE_HEIGHT_RATIO;
}

export function getAvatarBodyScale(playerHeightM?: number | null): number {
    return getAvatarBodyHeightM(playerHeightM) / DEFAULT_PLAYER_HEIGHT_M;
}
