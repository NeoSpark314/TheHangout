async function sendCommand(sessionId, command, payload = null) {
    try {
        const res = await fetch(`/api/admin/session/${sessionId}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, payload })
        });
        const data = await res.json();
        if (data.success) {
            console.log('Command successful');
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

async function fetchSessions() {
    try {
        const res = await fetch('/api/admin/sessions');
        const sessions = await res.json();
        const el = document.getElementById('sessions');

        if (sessions.length === 0) {
            el.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px; opacity: 0.5;">NO ACTIVE SESSIONS</div>';
            return;
        }

        el.innerHTML = sessions.map(r => `
            <div class="session-card">
                <span class="session-id">${r.id}</span>
                <div class="stat-row">
                    <span class="stat-label">Uptime</span>
                    <span class="stat-value">${r.uptime}s</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Clients</span>
                    <span class="stat-value">${r.clients}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Network</span>
                    <span class="stat-value">↓${formatBytes(r.network.in)} / ↑${formatBytes(r.network.out)}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Entities</span>
                    <span class="stat-value">${r.entityCount} (${r.entityBreakdown.players}P / ${r.entityBreakdown.props}E)</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Physics</span>
                    <span class="stat-value">${r.physics.bodies} bodies / ${r.physics.colliders} colliders</span>
                </div>
                
                <div style="margin-top: 15px; border-top: 1px solid #333; padding-top: 10px;">
                    <span class="stat-label" style="display: block; margin-bottom: 8px;">Active Peers:</span> 
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        ${r.peers.map(p => `
                            <div class="peer-row">
                                <span class="tag">${p.id.slice(0, 8)}</span>
                                <span class="peer-name">${p.name}</span>
                            </div>
                        `).join('') || '<span style="opacity: 0.5; font-size: 0.8em;">None</span>'}
                    </div>
                </div>

                <div class="controls">
                    <button onclick="sendCommand('${r.id}', 'spawn_cube')" class="primary">Spawn Cube</button>
                    <button onclick="sendCommand('${r.id}', 'reset')" class="danger">Reset Session</button>
                    
                    <div class="broadcast-group">
                        <input type="text" id="bc-${r.id}" placeholder="System message...">
                        <button onclick="const m = document.getElementById('bc-${r.id}').value; sendCommand('${r.id}', 'broadcast', m); document.getElementById('bc-${r.id}').value=''">Send</button>
                    </div>
                </div>
            </div>
        `).join('');
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
