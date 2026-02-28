import { IStateUpdatePacket } from '../interfaces/IEntityState';
import {
    IDrawSegmentPayload,
    IOwnershipReleasePayload,
    IOwnershipRequestPayload,
    IOwnershipTransferPayload,
    IPeerDisconnectPayload,
    IRoomConfigUpdatePayload
} from '../interfaces/INetworkPacket';
import { PACKET_TYPES } from '../utils/Constants';

export interface PacketPayloadMap {
    [PACKET_TYPES.STATE_UPDATE]: IStateUpdatePacket[];
    [PACKET_TYPES.PLAYER_INPUT]: IStateUpdatePacket[];
    [PACKET_TYPES.PEER_DISCONNECT]: string | IPeerDisconnectPayload;
    [PACKET_TYPES.ROOM_CONFIG_UPDATE]: IRoomConfigUpdatePayload;
    [PACKET_TYPES.OWNERSHIP_REQUEST]: IOwnershipRequestPayload;
    [PACKET_TYPES.OWNERSHIP_RELEASE]: IOwnershipReleasePayload;
    [PACKET_TYPES.OWNERSHIP_TRANSFER]: IOwnershipTransferPayload;
    [PACKET_TYPES.DRAW_LINE_SEGMENT]: IDrawSegmentPayload;
    [PACKET_TYPES.AUDIO_CHUNK]: unknown;
    [PACKET_TYPES.PEER_JOINED]: { peerId: string };
}

export interface NetworkEnvelope<K extends keyof PacketPayloadMap = keyof PacketPayloadMap> {
    type: K;
    payload: PacketPayloadMap[K];
    senderId?: string;
}
