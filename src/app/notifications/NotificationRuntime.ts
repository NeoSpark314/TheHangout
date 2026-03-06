import eventBus from '../events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import type { ISystemNotificationPayload, TSystemNotificationLevel } from '../../shared/contracts/INotification';

type TNotifyOptions = Omit<ISystemNotificationPayload, 'message' | 'level'>;

export class NotificationRuntime {
    private readonly dedupeUntilByKey = new Map<string, number>();
    private readonly recentEmitsMs: number[] = [];
    private readonly rateWindowMs = 3000;
    private readonly maxPerWindow = 6;

    public push(payload: string | ISystemNotificationPayload): void {
        const normalized = this.normalizePayload(payload);
        if (this.isRateLimited()) return;
        if (this.isDeduped(normalized)) return;
        eventBus.emit(EVENTS.SYSTEM_NOTIFICATION, normalized);
    }

    public info(message: string, options: TNotifyOptions = {}): void {
        this.push({ ...options, level: 'info', message });
    }

    public success(message: string, options: TNotifyOptions = {}): void {
        this.push({ ...options, level: 'success', message });
    }

    public warn(message: string, options: TNotifyOptions = {}): void {
        this.push({ ...options, level: 'warning', message });
    }

    public error(message: string, options: TNotifyOptions = {}): void {
        this.push({ ...options, level: 'error', message });
    }

    private normalizePayload(payload: string | ISystemNotificationPayload): ISystemNotificationPayload {
        if (typeof payload === 'string') {
            return {
                message: payload,
                level: 'info',
                source: 'system',
                durationMs: 4000
            };
        }

        return {
            level: payload.level || 'info',
            source: payload.source || 'system',
            durationMs: payload.durationMs ?? this.defaultDurationMs(payload.level || 'info'),
            message: payload.message,
            dedupeKey: payload.dedupeKey,
            code: payload.code
        };
    }

    private defaultDurationMs(level: TSystemNotificationLevel): number {
        if (level === 'error') return 5000;
        if (level === 'warning') return 3600;
        if (level === 'success') return 1800;
        return 2600;
    }

    private isRateLimited(): boolean {
        const now = this.nowMs();
        this.recentEmitsMs.push(now);
        while (this.recentEmitsMs.length > 0 && (now - this.recentEmitsMs[0]) > this.rateWindowMs) {
            this.recentEmitsMs.shift();
        }
        return this.recentEmitsMs.length > this.maxPerWindow;
    }

    private isDeduped(payload: ISystemNotificationPayload): boolean {
        const dedupeKey = payload.dedupeKey;
        if (!dedupeKey) return false;

        const now = this.nowMs();
        const until = this.dedupeUntilByKey.get(dedupeKey) || 0;
        if (until > now) return true;

        this.dedupeUntilByKey.set(dedupeKey, now + 1500);
        return false;
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}

