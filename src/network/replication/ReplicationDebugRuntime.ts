export type ReplicationDebugMode = 'off' | 'stats' | 'trace';
export type ReplicationTransportMode = 'broadcast' | 'to-host' | 'none';

export interface IReplicationFeatureStats {
    featureId: string;
    emitted: number;
    incoming: number;
    appliedLocal: number;
    appliedRemote: number;
    droppedSeen: number;
    droppedMissingFeature: number;
    relayed: number;
    relaySuppressed: number;
    localEchoSkipped: number;
    snapshotsCaptured: number;
    snapshotsApplied: number;
    snapshotsQueued: number;
    snapshotsPendingApplied: number;
}

export interface IReplicationTraceEntry {
    at: number;
    featureId: string;
    kind:
    | 'emit'
    | 'incoming'
    | 'apply-local'
    | 'apply-remote'
    | 'drop-seen'
    | 'drop-missing-feature'
    | 'relay'
    | 'relay-suppressed'
    | 'local-echo-skipped'
    | 'snapshot-capture'
    | 'snapshot-apply'
    | 'snapshot-queued'
    | 'snapshot-pending-applied';
    eventType?: string;
    eventId?: string;
    detail?: string;
}

interface IMutableFeatureStats extends IReplicationFeatureStats { }

export class ReplicationDebugRuntime {
    private mode: ReplicationDebugMode = 'off';
    private featureFilter: string | null = null;
    private readonly statsByFeature = new Map<string, IMutableFeatureStats>();
    private readonly traces: IReplicationTraceEntry[] = [];
    private readonly maxTraces = 512;

    public setMode(mode: ReplicationDebugMode): void {
        this.mode = mode;
    }

    public getMode(): ReplicationDebugMode {
        return this.mode;
    }

    public setFeatureFilter(featureId: string | null): void {
        const trimmed = typeof featureId === 'string' ? featureId.trim() : '';
        this.featureFilter = trimmed.length > 0 ? trimmed : null;
    }

    public getFeatureFilter(): string | null {
        return this.featureFilter;
    }

    public isEnabled(): boolean {
        return this.mode !== 'off';
    }

    public shouldTrackFeature(featureId: string): boolean {
        if (this.mode === 'off') return false;
        if (!this.featureFilter) return true;
        return featureId === this.featureFilter;
    }

    public clear(): void {
        this.statsByFeature.clear();
        this.traces.length = 0;
    }

    public recordEmit(featureId: string, eventType: string, eventId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'emitted');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'emit', eventType, eventId });
    }

    public recordIncoming(featureId: string, eventType: string, eventId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'incoming');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'incoming', eventType, eventId });
    }

    public recordApplied(featureId: string, local: boolean, eventType: string, eventId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, local ? 'appliedLocal' : 'appliedRemote');
        this.pushTrace({ at: this.nowMs(), featureId, kind: local ? 'apply-local' : 'apply-remote', eventType, eventId });
    }

    public recordDropSeen(featureId: string, eventType: string, eventId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'droppedSeen');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'drop-seen', eventType, eventId });
    }

    public recordDropMissingFeature(featureId: string, eventType: string, eventId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'droppedMissingFeature');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'drop-missing-feature', eventType, eventId });
    }

    public recordRelay(featureId: string, relayed: boolean): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, relayed ? 'relayed' : 'relaySuppressed');
        this.pushTrace({
            at: this.nowMs(),
            featureId,
            kind: relayed ? 'relay' : 'relay-suppressed'
        });
    }

    public recordLocalEchoSkipped(featureId: string, eventType: string, eventId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'localEchoSkipped');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'local-echo-skipped', eventType, eventId });
    }

    public recordSnapshotCapture(featureId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'snapshotsCaptured');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'snapshot-capture' });
    }

    public recordSnapshotApply(featureId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'snapshotsApplied');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'snapshot-apply' });
    }

    public recordSnapshotQueued(featureId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'snapshotsQueued');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'snapshot-queued' });
    }

    public recordSnapshotPendingApplied(featureId: string): void {
        if (!this.shouldTrackFeature(featureId)) return;
        this.bump(featureId, 'snapshotsPendingApplied');
        this.pushTrace({ at: this.nowMs(), featureId, kind: 'snapshot-pending-applied' });
    }

    public getFeatureStats(featureId: string): IReplicationFeatureStats {
        const stats = this.getOrCreateStats(featureId);
        return { ...stats };
    }

    public listFeatureStats(limit: number = 20): IReplicationFeatureStats[] {
        const rows = Array.from(this.statsByFeature.values()).map((entry) => ({ ...entry }));
        rows.sort((a, b) => {
            const aScore = a.emitted + a.incoming + a.appliedLocal + a.appliedRemote;
            const bScore = b.emitted + b.incoming + b.appliedLocal + b.appliedRemote;
            return bScore - aScore;
        });
        return rows.slice(0, Math.max(0, limit));
    }

    public getRecentTraces(limit: number = 50): IReplicationTraceEntry[] {
        if (limit <= 0) return [];
        return this.traces.slice(-limit).reverse();
    }

    private bump(featureId: string, key: keyof Omit<IReplicationFeatureStats, 'featureId'>): void {
        const stats = this.getOrCreateStats(featureId);
        stats[key] += 1;
    }

    private getOrCreateStats(featureId: string): IMutableFeatureStats {
        let stats = this.statsByFeature.get(featureId);
        if (!stats) {
            stats = {
                featureId,
                emitted: 0,
                incoming: 0,
                appliedLocal: 0,
                appliedRemote: 0,
                droppedSeen: 0,
                droppedMissingFeature: 0,
                relayed: 0,
                relaySuppressed: 0,
                localEchoSkipped: 0,
                snapshotsCaptured: 0,
                snapshotsApplied: 0,
                snapshotsQueued: 0,
                snapshotsPendingApplied: 0
            };
            this.statsByFeature.set(featureId, stats);
        }
        return stats;
    }

    private pushTrace(entry: IReplicationTraceEntry): void {
        if (this.mode !== 'trace') return;
        this.traces.push(entry);
        if (this.traces.length > this.maxTraces) {
            this.traces.shift();
        }
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
