async function sendCommand(roomId, command, payload = null) {
    try {
        const res = await fetch(`/api/admin/room/${roomId}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, payload })
        });
        const data = await res.json();
        if (data.success) {
            console.log('Command successful');
            fetchRooms();
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

async function fetchRooms() {
    try {
        const res = await fetch('/api/admin/rooms');
        const rooms = await res.json();
        const el = document.getElementById('rooms');

        if (rooms.length === 0) {
            el.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px; opacity: 0.5;">NO ACTIVE SESSIONS</div>';
            return;
        }

        el.innerHTML = rooms.map(r => `
            <div class="room-card">
                <span class="room-id">${r.id}</span>
                <div class="stat-row">
                    <span class="stat-label">Uptime</span>
                    <span class="stat-value">${r.uptime}s</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Clients</span>
                    <span class="stat-value">${r.clients}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Entities</span>
                    <span class="stat-value">${r.entityCount} (${r.entityBreakdown.players}P / ${r.entityBreakdown.props}E)</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Physics</span>
                    <span class="stat-value">${r.physics.bodies} bodies / ${r.physics.colliders} colliders</span>
                </div>
                
                <div style="margin-top: 10px; font-size: 0.8em;">
                    <span class="stat-label">Peers:</span> 
                    <div style="margin-top: 5px;">
                        ${r.peerIds.map(p => `<span class="tag">${p}</span>`).join('') || 'None'}
                    </div>
                </div>

                <div class="controls">
                    <button onclick="sendCommand('${r.id}', 'spawn_cube')" class="primary">Spawn Cube</button>
                    <button onclick="sendCommand('${r.id}', 'reset')" class="danger">Reset Room</button>
                    
                    <div class="broadcast-group">
                        <input type="text" id="bc-${r.id}" placeholder="System message...">
                        <button onclick="const m = document.getElementById('bc-${r.id}').value; sendCommand('${r.id}', 'broadcast', m); document.getElementById('bc-${r.id}').value=''">Send</button>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to fetch rooms:', e);
    }
}

function updateAll() {
    fetchServerStats();
    fetchRooms();
}

setInterval(updateAll, 3000);
updateAll();
