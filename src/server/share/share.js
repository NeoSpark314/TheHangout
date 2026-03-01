const keyInput = document.getElementById('share-key');
const connectBtn = document.getElementById('connect-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const codecText = document.getElementById('codec-text');

const STORAGE_KEY = 'hangout_desktopSourceKey';

let socket = null;
let activeKey = '';
let captureStream = null;
let captureVideo = null;
let captureCanvas = null;
let captureTimer = null;
let useWebP = false;

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
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 8, max: 12 } },
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
        if (!ctx) {
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

        captureTimer = setInterval(() => {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            if (!captureVideo || !captureCanvas) return;

            const srcW = Math.max(640, captureVideo.videoWidth || 1280);
            const srcH = Math.max(360, captureVideo.videoHeight || 720);
            const outW = 1280;
            const outH = Math.max(720, Math.round((srcH / srcW) * outW));

            captureCanvas.width = outW;
            captureCanvas.height = outH;
            ctx.drawImage(captureVideo, 0, 0, outW, outH);

            const mime = useWebP ? 'image/webp' : 'image/jpeg';
            const quality = useWebP ? 0.68 : 0.62;
            const dataUrl = captureCanvas.toDataURL(mime, quality);

            socket.send(JSON.stringify({
                type: 'source-frame',
                key: activeKey,
                dataUrl,
                width: outW,
                height: outH,
                ts: Date.now()
            }));
        }, 150);
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
            setStatus('Invalid server message', 'error');
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

const savedKey = localStorage.getItem(STORAGE_KEY);
if (savedKey) {
    keyInput.value = savedKey;
}
updateButtons();
