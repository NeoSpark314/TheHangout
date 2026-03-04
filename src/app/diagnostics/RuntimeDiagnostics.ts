export type DiagnosticLevel = 'error' | 'warn' | 'info' | 'debug';
export type DiagnosticCategory = 'network' | 'session' | 'replication' | 'system';

export interface IDiagnosticEntry {
    id: number;
    level: DiagnosticLevel;
    category: DiagnosticCategory;
    message: string;
    timestamp: number;
}

export interface INetworkMetricsSnapshot {
    txBps: number;
    rxBps: number;
    txTotal: number;
    rxTotal: number;
    lastRttMs: number | null;
    avgRttMs: number | null;
    jitterMs: number | null;
    latencySamples: number;
}

interface IByteSample {
    at: number;
    bytes: number;
}

interface ILatencySample {
    at: number;
    rttMs: number;
}

export class RuntimeDiagnostics {
    private readonly entries: IDiagnosticEntry[] = [];
    private readonly txSamples: IByteSample[] = [];
    private readonly rxSamples: IByteSample[] = [];
    private readonly latencySamples: ILatencySample[] = [];
    private nextEntryId = 1;
    private readonly maxEntries = 64;
    private readonly sampleWindowMs = 1000;
    private readonly latencyWindowMs = 30000;
    private txTotal = 0;
    private rxTotal = 0;

    public record(level: DiagnosticLevel, category: DiagnosticCategory, message: string): void {
        const entry: IDiagnosticEntry = {
            id: this.nextEntryId++,
            level,
            category,
            message,
            timestamp: this.nowMs()
        };

        this.entries.push(entry);
        while (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }

        const prefix = `[${category}] ${message}`;
        if (level === 'error') {
            console.error(prefix);
        } else if (level === 'warn') {
            console.warn(prefix);
        }
    }

    public recordNetworkSent(bytes: number): void {
        if (bytes <= 0) return;
        this.txTotal += bytes;
        this.txSamples.push({ at: this.nowMs(), bytes });
        this.pruneSamples(this.txSamples);
    }

    public recordNetworkReceived(bytes: number): void {
        if (bytes <= 0) return;
        this.rxTotal += bytes;
        this.rxSamples.push({ at: this.nowMs(), bytes });
        this.pruneSamples(this.rxSamples);
    }

    public recordRoundTripTime(rttMs: number): void {
        if (!Number.isFinite(rttMs) || rttMs < 0) return;
        this.latencySamples.push({
            at: this.nowMs(),
            rttMs
        });
        this.pruneLatencySamples();
    }

    public getRecentEntries(limit: number = 5): IDiagnosticEntry[] {
        if (limit <= 0) return [];
        return this.entries.slice(-limit).reverse();
    }

    public getNetworkMetricsSnapshot(): INetworkMetricsSnapshot {
        this.pruneSamples(this.txSamples);
        this.pruneSamples(this.rxSamples);
        this.pruneLatencySamples();

        const lastRttMs = this.latencySamples.length > 0
            ? this.latencySamples[this.latencySamples.length - 1].rttMs
            : null;

        let avgRttMs: number | null = null;
        if (this.latencySamples.length > 0) {
            let total = 0;
            for (const sample of this.latencySamples) total += sample.rttMs;
            avgRttMs = total / this.latencySamples.length;
        }

        return {
            txBps: this.sumBytes(this.txSamples),
            rxBps: this.sumBytes(this.rxSamples),
            txTotal: this.txTotal,
            rxTotal: this.rxTotal,
            lastRttMs,
            avgRttMs,
            jitterMs: this.computeJitterMs(),
            latencySamples: this.latencySamples.length
        };
    }

    private pruneSamples(samples: IByteSample[]): void {
        const cutoff = this.nowMs() - this.sampleWindowMs;
        while (samples.length > 0 && samples[0].at < cutoff) {
            samples.shift();
        }
    }

    private sumBytes(samples: IByteSample[]): number {
        let total = 0;
        for (const sample of samples) {
            total += sample.bytes;
        }
        return total;
    }

    private pruneLatencySamples(): void {
        const cutoff = this.nowMs() - this.latencyWindowMs;
        while (this.latencySamples.length > 0 && this.latencySamples[0].at < cutoff) {
            this.latencySamples.shift();
        }
    }

    private computeJitterMs(): number | null {
        if (this.latencySamples.length < 2) return null;

        let totalDelta = 0;
        for (let i = 1; i < this.latencySamples.length; i++) {
            totalDelta += Math.abs(this.latencySamples[i].rttMs - this.latencySamples[i - 1].rttMs);
        }

        return totalDelta / (this.latencySamples.length - 1);
    }

    private nowMs(): number {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
}
