import type { AvatarRenderMode } from '../contracts/IAvatar';

export interface IStoredScreenConfig {
    name: string;
    key: string;
}

interface IAppStorageProfileV1 {
    playerName?: string;
    avatarColor?: string;
    avatarRenderMode?: AvatarRenderMode;
    avatarVrmUrl?: string;
    avatarPlayerHeightM?: number;
}

interface IAppStorageSessionV1 {
    lastSessionId?: string;
}

interface IAppStorageSettingsV1 {
    voiceAutoEnable?: boolean;
    preferredMicDeviceId?: string;
}

interface IAppStorageRemoteDesktopV1 {
    screens?: IStoredScreenConfig[];
}

interface IAppStorageDataV1 {
    profile?: IAppStorageProfileV1;
    session?: IAppStorageSessionV1;
    settings?: IAppStorageSettingsV1;
    remoteDesktop?: IAppStorageRemoteDesktopV1;
}

interface IAppStorageEnvelopeV1 {
    version: 1;
    data: IAppStorageDataV1;
}

type IAppStorageEnvelope = IAppStorageEnvelopeV1;

const STORAGE_KEY = 'hangout_appState';
const STORAGE_VERSION = 1 as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asNonEmptyTrimmedString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeScreens(value: unknown): IStoredScreenConfig[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isRecord)
        .map((item) => ({
            name: asNonEmptyTrimmedString(item.name) || '',
            key: asNonEmptyTrimmedString(item.key) || ''
        }))
        .filter((item) => item.name.length > 0 && item.key.length > 0);
}

function sanitizeDataV1(value: unknown): IAppStorageDataV1 {
    if (!isRecord(value)) return {};

    const profile = isRecord(value.profile)
        ? {
            playerName: asNonEmptyTrimmedString(value.profile.playerName),
            avatarColor: asNonEmptyTrimmedString(value.profile.avatarColor),
            avatarRenderMode: (
                value.profile.avatarRenderMode === 'coordinates'
                    ? 'coordinates'
                    : value.profile.avatarRenderMode === 'vrm-auto'
                        ? 'vrm-auto'
                        : 'stick'
            ) as AvatarRenderMode,
            avatarVrmUrl: asNonEmptyTrimmedString(value.profile.avatarVrmUrl),
            avatarPlayerHeightM: typeof value.profile.avatarPlayerHeightM === 'number' && Number.isFinite(value.profile.avatarPlayerHeightM)
                ? value.profile.avatarPlayerHeightM
                : undefined
        }
        : undefined;

    const session = isRecord(value.session)
        ? { lastSessionId: asNonEmptyTrimmedString(value.session.lastSessionId) }
        : undefined;

    const settings = isRecord(value.settings)
        ? {
            voiceAutoEnable: typeof value.settings.voiceAutoEnable === 'boolean'
                ? value.settings.voiceAutoEnable
                : undefined,
            preferredMicDeviceId: asNonEmptyTrimmedString(value.settings.preferredMicDeviceId)
        }
        : undefined;

    const remoteDesktop = isRecord(value.remoteDesktop)
        ? { screens: sanitizeScreens(value.remoteDesktop.screens) }
        : undefined;

    return { profile, session, settings, remoteDesktop };
}

function readEnvelope(): IAppStorageEnvelope {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        const migrated = {
            version: STORAGE_VERSION,
            data: {}
        } as IAppStorageEnvelope;
        writeEnvelope(migrated);
        return migrated;
    }

    try {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
            const reset = {
                version: STORAGE_VERSION,
                data: {}
            } as IAppStorageEnvelope;
            writeEnvelope(reset);
            return reset;
        }

        const envelope: IAppStorageEnvelope = {
            version: STORAGE_VERSION,
            data: sanitizeDataV1(parsed.data)
        };
        writeEnvelope(envelope);
        return envelope;
    } catch {
        const reset = {
            version: STORAGE_VERSION,
            data: {}
        } as IAppStorageEnvelope;
        writeEnvelope(reset);
        return reset;
    }
}

function writeEnvelope(envelope: IAppStorageEnvelope): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

export class AppLocalStorage {
    public static getVersion(): number {
        return STORAGE_VERSION;
    }

    public static getPlayerName(): string | undefined {
        return readEnvelope().data.profile?.playerName;
    }

    public static setPlayerName(name: string): void {
        this.update((data) => {
            data.profile = data.profile || {};
            data.profile.playerName = asNonEmptyTrimmedString(name);
        });
    }

    public static getLastSessionId(): string | undefined {
        return readEnvelope().data.session?.lastSessionId;
    }

    public static setLastSessionId(sessionId: string): void {
        this.update((data) => {
            data.session = data.session || {};
            data.session.lastSessionId = asNonEmptyTrimmedString(sessionId);
        });
    }

    public static getVoiceAutoEnable(): boolean | undefined {
        return readEnvelope().data.settings?.voiceAutoEnable;
    }

    public static setVoiceAutoEnable(enabled: boolean): void {
        this.update((data) => {
            data.settings = data.settings || {};
            data.settings.voiceAutoEnable = !!enabled;
        });
    }

    public static getPreferredMicDeviceId(): string | undefined {
        return readEnvelope().data.settings?.preferredMicDeviceId;
    }

    public static setPreferredMicDeviceId(deviceId: string | null | undefined): void {
        this.update((data) => {
            data.settings = data.settings || {};
            data.settings.preferredMicDeviceId = asNonEmptyTrimmedString(deviceId);
        });
    }

    public static getAvatarColor(): string | undefined {
        return readEnvelope().data.profile?.avatarColor;
    }

    public static setAvatarColor(color: string): void {
        this.update((data) => {
            data.profile = data.profile || {};
            data.profile.avatarColor = asNonEmptyTrimmedString(color);
        });
    }

    public static getAvatarRenderMode(): AvatarRenderMode | undefined {
        return readEnvelope().data.profile?.avatarRenderMode;
    }

    public static setAvatarRenderMode(renderMode: AvatarRenderMode): void {
        this.update((data) => {
            data.profile = data.profile || {};
            data.profile.avatarRenderMode = renderMode;
        });
    }

    public static getAvatarVrmUrl(): string | undefined {
        return readEnvelope().data.profile?.avatarVrmUrl;
    }

    public static setAvatarVrmUrl(url: string | null | undefined): void {
        this.update((data) => {
            data.profile = data.profile || {};
            data.profile.avatarVrmUrl = asNonEmptyTrimmedString(url);
        });
    }

    public static getAvatarPlayerHeightM(): number | undefined {
        return readEnvelope().data.profile?.avatarPlayerHeightM;
    }

    public static setAvatarPlayerHeightM(heightM: number): void {
        this.update((data) => {
            data.profile = data.profile || {};
            data.profile.avatarPlayerHeightM = Number.isFinite(heightM) ? heightM : undefined;
        });
    }

    public static getRemoteDesktopScreens(): IStoredScreenConfig[] {
        return readEnvelope().data.remoteDesktop?.screens || [];
    }

    public static setRemoteDesktopScreens(screens: IStoredScreenConfig[]): void {
        this.update((data) => {
            data.remoteDesktop = data.remoteDesktop || {};
            data.remoteDesktop.screens = sanitizeScreens(screens);
        });
    }

    private static update(mutator: (data: IAppStorageDataV1) => void): void {
        const envelope = readEnvelope();
        const nextData = sanitizeDataV1(envelope.data);
        mutator(nextData);
        writeEnvelope({
            version: STORAGE_VERSION,
            data: sanitizeDataV1(nextData)
        });
    }
}

