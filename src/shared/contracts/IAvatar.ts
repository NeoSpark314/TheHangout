export type AvatarRenderMode = 'stick' | 'vrm-auto';

export interface IAvatarConfig {
    color: string | number;
    renderMode: AvatarRenderMode;
    vrmUrl?: string | null;
}

export const DEFAULT_AVATAR_COLOR = '#00ffff';

export function normalizeAvatarConfig(config?: Partial<IAvatarConfig> | null): IAvatarConfig {
    const color = config?.color ?? DEFAULT_AVATAR_COLOR;
    const vrmUrl = typeof config?.vrmUrl === 'string'
        ? config.vrmUrl.trim() || null
        : null;
    const renderMode: AvatarRenderMode = config?.renderMode === 'vrm-auto' && vrmUrl
        ? 'vrm-auto'
        : 'stick';

    return {
        color,
        renderMode,
        vrmUrl
    };
}
