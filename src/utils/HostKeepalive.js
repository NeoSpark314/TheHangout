// utils/HostKeepalive.js

/**
 * Keeps the dedicated host's network sync alive when the browser tab is hidden.
 *
 * Problem: Browsers throttle/pause requestAnimationFrame and setInterval when
 * a tab is backgrounded. This kills the host's sync loop.
 *
 * Solution: A Web Worker runs an unthrottled timer that posts messages back
 * to the main thread, driving the network sync tick even when the tab is hidden.
 *
 * Note: This is a browser workaround. The proper solution is Phase 2 (Node.js
 * server) where the host process runs natively without browser restrictions.
 */

let worker = null;
let onTickCallback = null;

const WORKER_CODE = `
    let interval = null;
    self.onmessage = (e) => {
        if (e.data === 'start') {
            // Tick at 20 Hz (50ms) — matches NetworkManager.syncRate
            interval = setInterval(() => self.postMessage('tick'), 50);
        } else if (e.data === 'stop') {
            if (interval) clearInterval(interval);
            interval = null;
        }
    };
`;

/**
 * Start the keepalive worker. The callback fires at ~20Hz even when the tab is hidden.
 * @param {Function} callback - Called on each tick with approximate delta in seconds
 */
export function startKeepalive(callback) {
    if (worker) return; // Already running

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
    console.log('[HostKeepalive] Worker started — sync will continue in background tab.');
}

/**
 * Stop the keepalive worker.
 */
export function stopKeepalive() {
    if (worker) {
        worker.postMessage('stop');
        worker.terminate();
        worker = null;
        onTickCallback = null;
        console.log('[HostKeepalive] Worker stopped.');
    }
}
