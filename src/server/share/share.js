const keyInput = document.getElementById('share-key');
const connectBtn = document.getElementById('connect-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const codecText = document.getElementById('codec-text');

const qualityInput = document.getElementById('quality-range');
const qualityVal = document.getElementById('quality-val');
const fpsSelect = document.getElementById('fps-select');
const previewToggle = document.getElementById('preview-toggle');
const previewContainer = document.getElementById('preview-container');
const previewCanvas = document.getElementById('preview-canvas');
const bandwidthText = document.getElementById('bandwidth-text');
const resText = document.getElementById('res-text');

const STORAGE_KEY = 'hangout_desktopSourceKey';

let socket = null;
let activeKey = '';
let captureStream = null;
let captureVideo = null;
let captureCanvas = null;
let captureTimer = null;
let useWebP = false;

let isWatched = false;
let bytesSentRecent = 0;
let lastStatsTs = Date.now();
let showPreview = false;

function setStatus(text, cls = '') {
    statusText.textContent = text;
    statusText.className = cls;
}

function updateButtons() {
    const connected = !!socket && socket.readyState === WebSocket.OPEN;
    const capturing = !!captureStream;
    connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
    startBtn.disabled = !connected || capturing;
    stopBtn.disabled = !connected || !capturing;
}

function getSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = window.location.port;
    const portPart = (port === '443' || port === '80' || port === '') ? '' : `:${port}`;
    return `${protocol}//${window.location.hostname}${portPart}/desktop-source`;
}

function registerSource() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    console.log(`[share] Registering global source with key: ${activeKey}`);
    socket.send(JSON.stringify({
        type: 'register-global-source',
        key: activeKey
    }));
}

function stopCapture(notifyServer = false) {
    if (captureTimer) {
        clearInterval(captureTimer);
        captureTimer = null;
    }

    if (captureVideo) {
        captureVideo.pause();
        captureVideo.srcObject = null;
        captureVideo = null;
    }

    if (captureStream) {
        captureStream.getTracks().forEach((t) => t.stop());
        captureStream = null;
    }

    captureCanvas = null;
    if (notifyServer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'source-capture-stopped',
            key: activeKey
        }));
    }

    setStatus(`Connected as "${activeKey}" (standby)`, 'ok');
    updateButtons();
}

async function startCapture() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (captureStream) return;

    try {
        const targetFps = parseInt(fpsSelect.value) || 12;
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: targetFps, max: targetFps + 5 } },
            audio: false
        });

        captureStream = stream;
        captureVideo = document.createElement('video');
        captureVideo.srcObject = stream;
        captureVideo.muted = true;
        captureVideo.playsInline = true;
        await captureVideo.play();

        captureCanvas = document.createElement('canvas');
        const ctx = captureCanvas.getContext('2d');
        const previewCtx = previewCanvas.getContext('2d');
        if (!ctx || !previewCtx) {
            throw new Error('No 2D context');
        }

        // Probe browser encoder once.
        captureCanvas.width = 16;
        captureCanvas.height = 16;
        useWebP = captureCanvas.toDataURL('image/webp', 0.7).startsWith('data:image/webp');
        codecText.textContent = useWebP ? 'webp' : 'jpeg';

        const track = stream.getVideoTracks()[0];
        track.addEventListener('ended', () => {
            stopCapture(true);
        }, { once: true });

        setStatus(`Streaming "${activeKey}"`, 'warn');

        if (socket && socket.readyState === WebSocket.OPEN) {
            console.log(`[share] Sending source-capture-started for key: ${activeKey}`);
            socket.send(JSON.stringify({
                type: 'source-capture-started',
                key: activeKey
            }));
        }

        captureTimer = setInterval(async () => {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            if (!captureVideo || !captureCanvas) return;

            // Stats Tick (every 1s approx)
            const now = Date.now();
            const dt = (now - lastStatsTs) / 1000;
            if (dt >= 1.0) {
                const kbps = Math.round((bytesSentRecent / 1024) / dt);
                bandwidthText.textContent = `${kbps} KB/s`;
                bytesSentRecent = 0;
                lastStatsTs = now;
            }

            const srcW = Math.max(640, captureVideo.videoWidth || 1280);
            const srcH = Math.max(360, captureVideo.videoHeight || 720);
            const outW = 1280;
            const outH = Math.max(720, Math.round((srcH / srcW) * outW));

            resText.textContent = `${srcW}x${srcH} (-> ${outW}x${outH})`;

            // Smart Transmission Optimization
            if (!isWatched) {
                setStatus(`Streaming "${activeKey}" (PAUSED - No room is watching)`, 'warn');
                return;
            }
            setStatus(`Streaming "${activeKey}" (LIVE)`, 'ok');

            captureCanvas.width = outW;
            captureCanvas.height = outH;
            ctx.drawImage(captureVideo, 0, 0, outW, outH);

            if (showPreview) {
                previewCanvas.width = outW;
                previewCanvas.height = outH;
                previewCtx.drawImage(captureCanvas, 0, 0);
            }

            const mime = useWebP ? 'image/webp' : 'image/jpeg';
            const quality = parseInt(qualityInput.value) / 100;

            captureCanvas.toBlob(async (blob) => {
                if (!blob || !socket || socket.readyState !== WebSocket.OPEN) return;
                if (!isWatched) return; // Re-check inside async callback

                const imageData = await blob.arrayBuffer();
                bytesSentRecent += imageData.byteLength;

                const keyEncoded = new TextEncoder().encode(activeKey);

                // Binary Format: [Type: 1b][KeyLen: 1b][Key: Nb][Image: Mb]
                const buffer = new Uint8Array(2 + keyEncoded.length + imageData.byteLength);
                buffer[0] = 19; // PACKET_TYPES.DESKTOP_STREAM_FRAME
                buffer[1] = keyEncoded.length;
                buffer.set(keyEncoded, 2);
                buffer.set(new Uint8Array(imageData), 2 + keyEncoded.length);

                socket.send(buffer);
            }, mime, quality);
        }, 1000 / targetFps);
    } catch (err) {
        console.error('[share] capture failed', err);
        stopCapture(false);
        setStatus('Capture denied or unavailable', 'error');
    } finally {
        updateButtons();
    }
}

function connect() {
    const key = keyInput.value.trim();
    if (!key) {
        setStatus('Enter a share key first', 'error');
        return;
    }

    localStorage.setItem(STORAGE_KEY, key);
    activeKey = key;
    socket = new WebSocket(getSocketUrl());
    setStatus('Connecting...', 'warn');
    updateButtons();

    socket.onopen = () => {
        registerSource();
        setStatus(`Connected as "${activeKey}" (standby)`, 'ok');
        updateButtons();
    };

    socket.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'source-registered') {
                const suffix = msg.collision ? ' (collision: replaced previous source)' : '';
                setStatus(`Registered "${msg.key}"${suffix}`, 'ok');
                return;
            }
            if (msg.type === 'watch-status') {
                isWatched = msg.isWatched;
                console.log(`[share] Watch status update: ${isWatched}`);
                return;
            }
            if (msg.type === 'command-start-capture') {
                await startCapture();
                return;
            }
            if (msg.type === 'command-stop-capture') {
                stopCapture(false);
                return;
            }
            if (msg.type === 'source-error') {
                setStatus(msg.message || 'Source error', 'error');
            }
        } catch {
            // Ignore non-JSON or other messages
        }
    };

    socket.onclose = () => {
        stopCapture(false);
        socket = null;
        setStatus('Disconnected', '');
        updateButtons();
    };

    socket.onerror = () => {
        setStatus('Socket error', 'error');
    };
}

function disconnect() {
    stopCapture(false);
    if (socket) {
        try {
            socket.close();
        } catch { }
        socket = null;
    }
    updateButtons();
}

// UI Listeners
connectBtn.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        disconnect();
    } else {
        connect();
    }
});

startBtn.addEventListener('click', () => {
    startCapture();
});

stopBtn.addEventListener('click', () => {
    stopCapture(true);
});

qualityInput.addEventListener('input', () => {
    qualityVal.textContent = `${qualityInput.value}%`;
});

fpsSelect.addEventListener('change', () => {
    // If already capturing, we need to restart the timer to respect new FPS immediately
    if (captureTimer) {
        clearInterval(captureTimer);
        const targetFps = parseInt(fpsSelect.value) || 12;
        // In a real app we might re-negotiate media constraints, but for now 
        // just changing the interval is a good start. 
        // startCapture implements this on next start.
        setStatus('Restart capture to apply FPS changes fully', 'warn');
    }
});

previewToggle.addEventListener('click', () => {
    showPreview = !showPreview;
    previewContainer.style.display = showPreview ? 'block' : 'none';
    previewToggle.textContent = showPreview ? 'Hide Preview' : 'Show Preview';
});

const savedKey = localStorage.getItem(STORAGE_KEY);
if (savedKey) {
    keyInput.value = savedKey;
}
updateButtons();
