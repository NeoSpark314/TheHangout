let worker: Worker | null = null;
let onTickCallback: ((delta: number) => void) | null = null;

const WORKER_CODE = `
    let interval = null;
    self.onmessage = (e) => {
        if (e.data === 'start') {
            interval = setInterval(() => self.postMessage('tick'), 50);
        } else if (e.data === 'stop') {
            if (interval) clearInterval(interval);
            interval = null;
        }
    };
`;

/**
 * Start the keepalive worker. The callback fires at ~20Hz even when the tab is hidden.
 * @param callback - Called on each tick with approximate delta in seconds
 */
export function startKeepalive(callback: (delta: number) => void): void {
    if (worker) return;

    onTickCallback = callback;
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    worker = new Worker(URL.createObjectURL(blob));

    let lastTime = performance.now();

    worker.onmessage = () => {
        const now = performance.now();
        const delta = (now - lastTime) / 1000;
        lastTime = now;

        if (onTickCallback) {
            onTickCallback(delta);
        }
    };

    worker.postMessage('start');
    console.log('[HostKeepalive] Worker started.');
}

/**
 * Stop the keepalive worker.
 */
export function stopKeepalive(): void {
    if (worker) {
        worker.postMessage('stop');
        worker.terminate();
        worker = null;
        onTickCallback = null;
        console.log('[HostKeepalive] Worker stopped.');
    }
}
