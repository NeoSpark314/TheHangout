export class SfxRenderCache {
    private readonly buffers = new Map<string, AudioBuffer>();
    private readonly inFlight = new Map<string, Promise<AudioBuffer>>();

    constructor(private readonly maxEntries: number = 64) { }

    public async getOrCreate(
        key: string,
        renderer: () => Promise<AudioBuffer>
    ): Promise<AudioBuffer> {
        const cached = this.buffers.get(key);
        if (cached) {
            this.touch(key, cached);
            return cached;
        }

        const running = this.inFlight.get(key);
        if (running) {
            return running;
        }

        const promise = renderer()
            .then((buffer) => {
                this.inFlight.delete(key);
                this.set(key, buffer);
                return buffer;
            })
            .catch((error) => {
                this.inFlight.delete(key);
                throw error;
            });

        this.inFlight.set(key, promise);
        return promise;
    }

    private set(key: string, buffer: AudioBuffer): void {
        this.buffers.set(key, buffer);
        this.evictIfNeeded();
    }

    private touch(key: string, buffer: AudioBuffer): void {
        this.buffers.delete(key);
        this.buffers.set(key, buffer);
    }

    private evictIfNeeded(): void {
        while (this.buffers.size > this.maxEntries) {
            const oldest = this.buffers.keys().next();
            if (oldest.done) break;
            this.buffers.delete(oldest.value);
        }
    }
}
