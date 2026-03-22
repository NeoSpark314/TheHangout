export type AvatarRenderMode = 'stick' | 'vrm-auto' | 'coordinates';

export interface IAvatarConfig {
    color: string | number;
    renderMode: AvatarRenderMode;
    vrmUrl?: string | null;
    playerHeightM: number;
}

export const DEFAULT_AVATAR_COLOR = '#00ffff';
export const DEFAULT_PLAYER_HEIGHT_M = 1.8;
export const MIN_PLAYER_HEIGHT_M = 1.2;
export const MAX_PLAYER_HEIGHT_M = 2.3;

export function clampPlayerHeightM(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_PLAYER_HEIGHT_M;
    }
    return Math.min(MAX_PLAYER_HEIGHT_M, Math.max(MIN_PLAYER_HEIGHT_M, value));
}

export function normalizeAvatarConfig(config?: Partial<IAvatarConfig> | null): IAvatarConfig {
    const color = config?.color ?? DEFAULT_AVATAR_COLOR;
    const vrmUrl = typeof config?.vrmUrl === 'string'
        ? config.vrmUrl.trim() || null
        : null;
    const playerHeightM = clampPlayerHeightM(config?.playerHeightM);
    let renderMode: AvatarRenderMode = 'stick';
    if (config?.renderMode === 'coordinates') {
        renderMode = 'coordinates';
    } else if (config?.renderMode === 'vrm-auto' && vrmUrl) {
        renderMode = 'vrm-auto';
    }

    return {
        color,
        renderMode,
        vrmUrl,
        playerHeightM
    };
}
