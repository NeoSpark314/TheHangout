export interface IPlayerBadgeState {
    name: string;
    isHost?: boolean;
    micEnabled?: boolean;
    isMuted?: boolean;
    audioLevel?: number;
}

export interface IPlayerBadgeOptions {
    includeHost?: boolean;
    includeMuted?: boolean;
    includeTalking?: boolean;
    talkingThreshold?: number;
}

export const PLAYER_BADGES = {
    host: '[Host]',
    micOff: '[MicOff]',
    mutedByYou: '[Muted]',
    talking: '[Talk]'
} as const;

export function formatPlayerDisplayName(
    state: IPlayerBadgeState,
    options: IPlayerBadgeOptions = {}
): string {
    const baseName = state.name || 'Player';
    const includeHost = options.includeHost ?? true;
    const includeMuted = options.includeMuted ?? true;
    const includeTalking = options.includeTalking ?? true;
    const talkingThreshold = options.talkingThreshold ?? 0.01;

    const badges: string[] = [];
    if (includeHost && state.isHost) badges.push(PLAYER_BADGES.host);

    const isMicDisabled = state.micEnabled === false;
    if (includeMuted) {
        if (isMicDisabled) {
            badges.push(PLAYER_BADGES.micOff);
        } else if (state.isMuted) {
            badges.push(PLAYER_BADGES.mutedByYou);
        }
    }

    if (
        includeTalking &&
        !isMicDisabled &&
        !state.isMuted &&
        typeof state.audioLevel === 'number' &&
        state.audioLevel > talkingThreshold
    ) {
        badges.push(PLAYER_BADGES.talking);
    }

    if (badges.length === 0) return baseName;
    return `${baseName} ${badges.join(' ')}`;
}
