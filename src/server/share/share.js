const keyInput = document.getElementById('share-key');
const connectBtn = document.getElementById('connect-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const codecText = document.getElementById('codec-text');

const qualitySelect = document.getElementById('quality-select');
const resSelect = document.getElementById('res-select');
const fpsSelect = document.getElementById('fps-select');
const previewCanvas = document.getElementById('preview-canvas');
const bandwidthText = document.getElementById('bandwidth-text');
const resText = document.getElementById('res-text');

const STORAGE_KEY = 'th_DesktopShapre_SecretKey';

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
const showPreview = true; // Always true now

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
    console.log(`[share] Registering source: ${activeKey}`);
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

function startCaptureLoop() {
    if (captureTimer) clearInterval(captureTimer);
    if (!captureStream || !captureVideo || !captureCanvas) return;

    const targetFps = parseInt(fpsSelect.value) || 12;
    const ctx = captureCanvas.getContext('2d');
    const previewCtx = previewCanvas.getContext('2d');

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

        // Resolution Logic
        let outW = srcW;
        let outH = srcH;
        const resPreset = resSelect.value;
        if (resPreset !== 'native') {
            const targetH = parseInt(resPreset);
            if (srcH > targetH) {
                outH = targetH;
                outW = Math.round((srcW / srcH) * targetH);
            }
        }

        resText.textContent = `${srcW}x${srcH} ${outH === srcH ? '(Native)' : `-> ${outW}x${outH}`}`;

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
        const quality = parseFloat(qualitySelect.value) || 0.65;

        const startTime = Date.now();
        captureCanvas.toBlob(async (blob) => {
            if (!blob || !socket || socket.readyState !== WebSocket.OPEN) return;
            if (!isWatched || !captureStream) return; // Discard if no one is watching OR capture stopped

            const imageData = await blob.arrayBuffer();
            bytesSentRecent += imageData.byteLength;

            const keyEncoded = new TextEncoder().encode(activeKey);

            // Binary Format: [Type: 1b][KeyLen: 1b][Key: Nb][Timestamp: 8b][Image: Mb]
            const buffer = new Uint8Array(2 + keyEncoded.length + 8 + imageData.byteLength);
            buffer[0] = 19; // PACKET_TYPES.DESKTOP_STREAM_FRAME
            buffer[1] = keyEncoded.length;
            buffer.set(keyEncoded, 2);

            // 8-byte BigEndian Timestamp (ms)
            const view = new DataView(buffer.buffer);
            view.setBigUint64(2 + keyEncoded.length, BigInt(startTime));

            buffer.set(new Uint8Array(imageData), 2 + keyEncoded.length + 8);

            socket.send(buffer);
        }, mime, quality);
    }, 1000 / targetFps);
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
            socket.send(JSON.stringify({
                type: 'source-capture-started',
                key: activeKey
            }));
        }

        startCaptureLoop();
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
        } catch { }
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

[qualitySelect, resSelect, fpsSelect].forEach(el => {
    el.addEventListener('change', () => {
        if (captureTimer) {
            startCaptureLoop();
        }
    });
});

const savedKey = localStorage.getItem(STORAGE_KEY);
if (savedKey) {
    keyInput.value = savedKey;
}
updateButtons();
