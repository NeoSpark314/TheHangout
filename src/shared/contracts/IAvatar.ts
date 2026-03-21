export type AvatarRenderMode = 'stick' | 'vrm-auto' | 'coordinates';

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
    let renderMode: AvatarRenderMode = 'stick';
    if (config?.renderMode === 'coordinates') {
        renderMode = 'coordinates';
    } else if (config?.renderMode === 'vrm-auto' && vrmUrl) {
        renderMode = 'vrm-auto';
    }

    return {
        color,
        renderMode,
        vrmUrl
    };
}
