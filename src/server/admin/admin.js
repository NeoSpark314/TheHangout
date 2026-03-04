async function sendCommand(sessionId, command, payload = null) {
    try {
        const res = await fetch(`/api/admin/session/${sessionId}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, payload })
        });
        const data = await res.json();
        if (data.success) {
            fetchSessions();
        }
    } catch (e) {
        console.error('Command failed:', e);
    }
}

async function fetchServerStats() {
    try {
        const res = await fetch('/api/admin/server-stats');
        const stats = await res.json();
        document.getElementById('server-uptime').textContent = stats.uptime + 's';
        document.getElementById('server-ram').textContent = stats.ram + 'MB';
    } catch (e) {
        console.error('Failed to fetch server stats:', e);
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderSessionCard(session) {
    const peersHtml = session.peers.map((peer) => `
        <div class="peer-row">
            <span class="synth-tag">${peer.id.slice(0, 8)}</span>
            <span class="peer-name">${peer.name}</span>
        </div>
    `).join('') || '<span class="peer-empty">None</span>';

    return `
        <div class="session-card synth-card synth-panel">
            <span class="session-id">${session.id}</span>
            <div class="stats-list">
                <div class="stat-row">
                    <span class="stat-label">Uptime</span>
                    <span class="stat-value">${session.uptime}s</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Clients</span>
                    <span class="stat-value">${session.clients}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Network</span>
                    <span class="stat-value">IN ${formatBytes(session.network.in)} / OUT ${formatBytes(session.network.out)}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Entities</span>
                    <span class="stat-value">${session.entityCount} (${session.entityBreakdown.players}P / ${session.entityBreakdown.props}E)</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Physics</span>
                    <span class="stat-value">${session.physics.bodies} bodies / ${session.physics.colliders} colliders</span>
                </div>
            </div>

            <div class="peer-section synth-divider">
                <span class="stat-label">Active Peers</span>
                <div class="peer-list">${peersHtml}</div>
            </div>

            <div class="controls synth-divider">
                <div class="controls-row">
                    <button onclick="sendCommand('${session.id}', 'spawn_cube')" class="synth-button">Spawn Cube</button>
                    <button onclick="sendCommand('${session.id}', 'reset')" class="synth-button is-danger">Reset Session</button>
                </div>
                <div class="broadcast-group">
                    <input type="text" id="bc-${session.id}" class="synth-input" placeholder="System message...">
                    <button
                        onclick="const m = document.getElementById('bc-${session.id}').value; sendCommand('${session.id}', 'broadcast', m); document.getElementById('bc-${session.id}').value=''"
                        class="synth-button is-secondary"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    `;
}

async function fetchSessions() {
    try {
        const res = await fetch('/api/admin/sessions');
        const sessions = await res.json();
        const el = document.getElementById('sessions');

        if (sessions.length === 0) {
            el.innerHTML = '<div class="synth-card synth-panel synth-empty">No Active Sessions</div>';
            return;
        }

        el.innerHTML = sessions.map(renderSessionCard).join('');
    } catch (e) {
        console.error('Failed to fetch sessions:', e);
    }
}

function updateAll() {
    fetchServerStats();
    fetchSessions();
}

setInterval(updateAll, 3000);
updateAll();
