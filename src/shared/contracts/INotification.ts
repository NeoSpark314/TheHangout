export type TSystemNotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface ISystemNotificationPayload {
    message: string;
    code?: string;
    level?: TSystemNotificationLevel;
    source?: string;
    durationMs?: number;
    dedupeKey?: string;
}
