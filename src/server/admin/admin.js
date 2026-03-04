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

const sessionCardState = new Map();

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

function formatAgeMs(ageMs) {
    if (ageMs === null || ageMs === undefined || !Number.isFinite(ageMs)) return 'n/a';
    if (ageMs < 1000) return Math.round(ageMs) + ' ms';
    return (ageMs / 1000).toFixed(1) + ' s';
}

function createStatRow(labelText) {
    const row = document.createElement('div');
    row.className = 'stat-row';

    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = labelText;

    const value = document.createElement('span');
    value.className = 'stat-value';

    row.append(label, value);
    return { row, value };
}

function createSessionCard(sessionId) {
    const card = document.createElement('div');
    card.className = 'session-card synth-card synth-panel';
    card.dataset.sessionId = sessionId;

    const id = document.createElement('span');
    id.className = 'session-id';
    id.textContent = sessionId;

    const statsList = document.createElement('div');
    statsList.className = 'stats-list';

    const uptime = createStatRow('Uptime');
    const clients = createStatRow('Clients');
    const network = createStatRow('Network');
    const entities = createStatRow('Entities');
    const physics = createStatRow('Physics');
    statsList.append(uptime.row, clients.row, network.row, entities.row, physics.row);

    const peerSection = document.createElement('div');
    peerSection.className = 'peer-section synth-divider';

    const peerLabel = document.createElement('span');
    peerLabel.className = 'stat-label';
    peerLabel.textContent = 'Active Peers';

    const peerList = document.createElement('div');
    peerList.className = 'peer-list';

    peerSection.append(peerLabel, peerList);

    const controls = document.createElement('div');
    controls.className = 'controls synth-divider';

    const controlsRow = document.createElement('div');
    controlsRow.className = 'controls-row';

    const resetButton = document.createElement('button');
    resetButton.className = 'synth-button is-danger';
    resetButton.textContent = 'Reset Session';
    resetButton.addEventListener('click', () => sendCommand(sessionId, 'reset'));

    controlsRow.append(resetButton);

    const broadcastGroup = document.createElement('div');
    broadcastGroup.className = 'broadcast-group';

    const broadcastInput = document.createElement('input');
    broadcastInput.type = 'text';
    broadcastInput.id = `bc-${sessionId}`;
    broadcastInput.className = 'synth-input';
    broadcastInput.placeholder = 'System message...';

    const sendButton = document.createElement('button');
    sendButton.className = 'synth-button is-secondary';
    sendButton.textContent = 'Send';
    sendButton.addEventListener('click', () => {
        const message = broadcastInput.value;
        sendCommand(sessionId, 'broadcast', message);
        broadcastInput.value = '';
    });

    broadcastGroup.append(broadcastInput, sendButton);
    controls.append(controlsRow, broadcastGroup);

    card.append(id, statsList, peerSection, controls);

    const refs = {
        card,
        uptime: uptime.value,
        clients: clients.value,
        network: network.value,
        entities: entities.value,
        physics: physics.value,
        peerList
    };

    sessionCardState.set(sessionId, refs);
    return refs;
}

function renderPeerRow(peer) {
    const row = document.createElement('div');
    row.className = 'peer-row';

    const tag = document.createElement('span');
    tag.className = 'synth-tag';
    tag.textContent = peer.id.slice(0, 8);

    const name = document.createElement('span');
    name.className = 'peer-name';
    name.textContent = peer.name;

    const details = document.createElement('span');
    details.className = 'peer-name';
    details.textContent =
        `RTT ${peer.latency?.lastRttMs?.toFixed?.(0) ?? 'n/a'} ms | ` +
        `J ${peer.latency?.jitterMs?.toFixed?.(0) ?? 'n/a'} ms | ` +
        `IN ${formatBytes(peer.bytesIn)} | ` +
        `OUT ${formatBytes(peer.bytesOut)} | ` +
        `Last ${formatAgeMs(Date.now() - (peer.lastMessageAt || Date.now()))}`;

    row.append(tag, name, details);
    return row;
}

function updateSessionCard(session) {
    const refs = sessionCardState.get(session.id) || createSessionCard(session.id);

    refs.uptime.textContent = `${session.uptime}s`;
    refs.clients.textContent = String(session.clients);
    refs.network.textContent = `IN ${formatBytes(session.network.in)} / OUT ${formatBytes(session.network.out)}`;
    refs.entities.textContent = `${session.entityCount} (${session.entityBreakdown.players}P / ${session.entityBreakdown.props}E)`;
    refs.physics.textContent = `${session.physics.bodies} bodies / ${session.physics.colliders} colliders`;

    refs.peerList.replaceChildren();
    if (session.peers.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'peer-empty';
        empty.textContent = 'None';
        refs.peerList.append(empty);
    } else {
        session.peers.forEach((peer) => {
            refs.peerList.append(renderPeerRow(peer));
        });
    }

    return refs.card;
}

async function fetchSessions() {
    try {
        const res = await fetch('/api/admin/sessions');
        const sessions = await res.json();
        const el = document.getElementById('sessions');

        if (sessions.length === 0) {
            el.innerHTML = '<div class="synth-card synth-panel synth-empty">No Active Sessions</div>';
            sessionCardState.clear();
            return;
        }

        const incomingIds = new Set(sessions.map((session) => session.id));
        for (const [sessionId, refs] of sessionCardState.entries()) {
            if (incomingIds.has(sessionId)) continue;
            refs.card.remove();
            sessionCardState.delete(sessionId);
        }

        const fragment = document.createDocumentFragment();
        sessions.forEach((session) => {
            fragment.append(updateSessionCard(session));
        });

        el.replaceChildren(fragment);
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
