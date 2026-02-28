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
    muted: '🔇',
    talking: '🔊'
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
    if (includeMuted && (isMicDisabled || state.isMuted)) badges.push(PLAYER_BADGES.muted);

    if (includeTalking && typeof state.audioLevel === 'number' && state.audioLevel > talkingThreshold) {
        badges.push(PLAYER_BADGES.talking);
    }

    if (badges.length === 0) return baseName;
    return `${baseName} ${badges.join(' ')}`;
}
