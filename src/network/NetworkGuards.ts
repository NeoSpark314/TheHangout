import { PACKET_TYPES } from '../utils/Constants';

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

function isRoomConfigPayload(payload: unknown): boolean {
    // Keep this permissive for compatibility with partial room updates.
    if (!isObject(payload)) return false;
    if ('assignedSpawnIndex' in payload && typeof payload.assignedSpawnIndex !== 'number') return false;
    return true;
}

function isDrawLinePayload(payload: unknown): boolean {
    if (!isObject(payload)) return false;
    if (!Array.isArray(payload.startPos) || !Array.isArray(payload.endPos)) return false;
    if ((payload.startPos as unknown[]).length < 3 || (payload.endPos as unknown[]).length < 3) return false;
    if (typeof payload.color !== 'string' && typeof payload.color !== 'number') return false;
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
        case PACKET_TYPES.ROOM_CONFIG_UPDATE:
            return isRoomConfigPayload(payload);
        case PACKET_TYPES.DRAW_LINE_SEGMENT:
            return isDrawLinePayload(payload);
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
        // Intentionally permissive for binary/string audio chunks and future packet extensions.
        case PACKET_TYPES.AUDIO_CHUNK:
        default:
            return true;
    }
}
