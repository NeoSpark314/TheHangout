import { PACKET_TYPES } from '../../shared/constants/Constants';

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function isStateUpdatePacketArray(payload: unknown): boolean {
    if (!Array.isArray(payload)) return false;
    for (const item of payload) {
        if (!isObject(item)) return false;
        if (typeof item.id !== 'string') return false;
        if (!('type' in item)) return false;
        if (!('state' in item)) return false;
    }
    return true;
}

function isOwnershipRequestPayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.entityId === 'string' &&
        (payload.seq === undefined || typeof payload.seq === 'number') &&
        (payload.sentAt === undefined || typeof payload.sentAt === 'number');
}

function isOwnershipReleasePayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.entityId === 'string' &&
        (payload.seq === undefined || typeof payload.seq === 'number') &&
        (payload.sentAt === undefined || typeof payload.sentAt === 'number');
}

function isOwnershipTransferPayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.entityId === 'string' &&
        (typeof payload.newOwnerId === 'string' || payload.newOwnerId === null) &&
        (payload.seq === undefined || typeof payload.seq === 'number') &&
        (payload.sentAt === undefined || typeof payload.sentAt === 'number');
}

function isSessionConfigPayload(payload: unknown): boolean {
    // Keep this permissive for compatibility with partial session updates.
    if (!isObject(payload)) return false;
    if ('assignedSpawnIndex' in payload && typeof payload.assignedSpawnIndex !== 'number') return false;
    return true;
}

function isPeerJoinedPayload(payload: unknown): boolean {
    return isObject(payload) && typeof payload.peerId === 'string';
}

function isPeerDisconnectPayload(payload: unknown): boolean {
    return typeof payload === 'string' || (isObject(payload) && typeof payload.peerId === 'string');
}

function isFeatureEventPayload(payload: unknown): boolean {
    return isObject(payload)
        && typeof payload.featureId === 'string'
        && typeof payload.eventType === 'string'
        && typeof payload.eventId === 'string'
        && typeof payload.originPeerId === 'string'
        && typeof payload.sentAt === 'number'
        && ('data' in payload);
}

function isFeatureSnapshotPayload(payload: unknown): boolean {
    if (!isObject(payload) || !Array.isArray(payload.features)) return false;
    for (const feature of payload.features) {
        if (!isObject(feature)) return false;
        if (typeof feature.featureId !== 'string') return false;
        if (!('snapshot' in feature)) return false;
    }
    return true;
}

function isFeatureSnapshotRequestPayload(payload: unknown): boolean {
    if (!isObject(payload)) return false;
    if ('request' in payload && typeof payload.request !== 'boolean') return false;
    return true;
}

function isDesktopSourcesStatusRequestPayload(payload: unknown): boolean {
    return isObject(payload) && Array.isArray(payload.keys);
}

function isDesktopSourcesStatusResponsePayload(payload: unknown): boolean {
    if (!isObject(payload) || !isObject(payload.statuses)) return false;
    if ('activeKeys' in payload && !Array.isArray(payload.activeKeys)) return false;
    return true;
}

function isDesktopStreamSummonPayload(payload: unknown): boolean {
    if (!isObject(payload) || typeof payload.key !== 'string') return false;
    if ('name' in payload && typeof payload.name !== 'string') return false;
    return true;
}

function isDesktopStreamStopPayload(payload: unknown): boolean {
    return isObject(payload) && typeof payload.key === 'string';
}

function isDesktopStreamSummonedPayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.key === 'string' &&
        typeof payload.sessionId === 'string';
}

function isDesktopStreamStoppedPayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.key === 'string' &&
        typeof payload.sessionId === 'string';
}

function isDesktopStreamOfflinePayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.key === 'string' &&
        typeof payload.sessionId === 'string';
}

function isDesktopStreamFramePayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.key === 'string' &&
        typeof payload.sessionId === 'string' &&
        typeof payload.dataUrl === 'string';
}

function isSessionNotificationPayload(payload: unknown): boolean {
    if (!isObject(payload) || typeof payload.kind !== 'string') return false;
    if ('actorPeerId' in payload && typeof payload.actorPeerId !== 'string') return false;
    if ('actorName' in payload && typeof payload.actorName !== 'string') return false;
    if ('subjectName' in payload && typeof payload.subjectName !== 'string') return false;
    if ('message' in payload && typeof payload.message !== 'string') return false;
    if ('sentAt' in payload && typeof payload.sentAt !== 'number') return false;
    if ('level' in payload && payload.level !== 'info' && payload.level !== 'warn' && payload.level !== 'error') return false;
    return true;
}

function isRttPingPayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.probeId === 'string' &&
        typeof payload.clientSentAt === 'number';
}

function isRttPongPayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.probeId === 'string' &&
        typeof payload.clientSentAt === 'number' &&
        typeof payload.serverReceivedAt === 'number' &&
        typeof payload.serverSentAt === 'number';
}

function isPeerLatencyReportPayload(payload: unknown): boolean {
    return isObject(payload) &&
        typeof payload.lastRttMs === 'number' &&
        typeof payload.reportedAt === 'number' &&
        (payload.avgRttMs === undefined || typeof payload.avgRttMs === 'number') &&
        (payload.jitterMs === undefined || typeof payload.jitterMs === 'number') &&
        (payload.samples === undefined || typeof payload.samples === 'number');
}

export function isValidPayloadForType(type: number, payload: unknown): boolean {
    switch (type) {
        case PACKET_TYPES.STATE_UPDATE:
        case PACKET_TYPES.PLAYER_INPUT:
            return isStateUpdatePacketArray(payload);
        case PACKET_TYPES.OWNERSHIP_REQUEST:
            return isOwnershipRequestPayload(payload);
        case PACKET_TYPES.OWNERSHIP_RELEASE:
            return isOwnershipReleasePayload(payload);
        case PACKET_TYPES.OWNERSHIP_TRANSFER:
            return isOwnershipTransferPayload(payload);
        case PACKET_TYPES.SESSION_CONFIG_UPDATE:
            return isSessionConfigPayload(payload);
        case PACKET_TYPES.PEER_JOINED:
            return isPeerJoinedPayload(payload);
        case PACKET_TYPES.PEER_DISCONNECT:
            return isPeerDisconnectPayload(payload);
        case PACKET_TYPES.FEATURE_EVENT:
            return isFeatureEventPayload(payload);
        case PACKET_TYPES.FEATURE_SNAPSHOT:
            return isFeatureSnapshotPayload(payload);
        case PACKET_TYPES.FEATURE_SNAPSHOT_REQUEST:
            return isFeatureSnapshotRequestPayload(payload);
        case PACKET_TYPES.DESKTOP_SOURCES_STATUS_REQUEST:
            return isDesktopSourcesStatusRequestPayload(payload);
        case PACKET_TYPES.DESKTOP_SOURCES_STATUS_RESPONSE:
            return isDesktopSourcesStatusResponsePayload(payload);
        case PACKET_TYPES.DESKTOP_STREAM_SUMMON:
            return isDesktopStreamSummonPayload(payload);
        case PACKET_TYPES.DESKTOP_STREAM_STOP:
            return isDesktopStreamStopPayload(payload);
        case PACKET_TYPES.DESKTOP_STREAM_SUMMONED:
            return isDesktopStreamSummonedPayload(payload);
        case PACKET_TYPES.DESKTOP_STREAM_STOPPED:
            return isDesktopStreamStoppedPayload(payload);
        case PACKET_TYPES.DESKTOP_STREAM_OFFLINE:
            return isDesktopStreamOfflinePayload(payload);
        case PACKET_TYPES.DESKTOP_STREAM_FRAME:
            return isDesktopStreamFramePayload(payload);
        case PACKET_TYPES.SESSION_NOTIFICATION:
            return isSessionNotificationPayload(payload);
        case PACKET_TYPES.RTT_PING:
            return isRttPingPayload(payload);
        case PACKET_TYPES.RTT_PONG:
            return isRttPongPayload(payload);
        case PACKET_TYPES.PEER_LATENCY_REPORT:
            return isPeerLatencyReportPayload(payload);
        // Intentionally permissive for binary/string audio chunks and future packet extensions.
        case PACKET_TYPES.AUDIO_CHUNK:
        default:
            return true;
    }
}
