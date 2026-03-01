import { IStateUpdatePacket } from '../interfaces/IEntityState';
import {
    IDesktopSourcesStatusRequestPayload,
    IDesktopSourcesStatusResponsePayload,
    IDesktopStreamFramePayload,
    IDesktopStreamOfflinePayload,
    IDesktopStreamStopPayload,
    IDesktopStreamStoppedPayload,
    IDesktopStreamSummonPayload,
    IDesktopStreamSummonedPayload,
    IRoomNotificationPayload,
    IFeatureSnapshotRequestPayload,
    IOwnershipReleasePayload,
    IOwnershipRequestPayload,
    IOwnershipTransferPayload,
    IPeerDisconnectPayload,
    IRoomConfigUpdatePayload
} from '../interfaces/INetworkPacket';
import { IReplicatedFeatureEventPayload, IReplicatedFeatureSnapshotPayload } from '../managers/ReplicationManager';
import { PACKET_TYPES } from '../utils/Constants';

export interface PacketPayloadMap {
    [PACKET_TYPES.STATE_UPDATE]: IStateUpdatePacket[];
    [PACKET_TYPES.PLAYER_INPUT]: IStateUpdatePacket[];
    [PACKET_TYPES.PEER_DISCONNECT]: string | IPeerDisconnectPayload;
    [PACKET_TYPES.ROOM_CONFIG_UPDATE]: IRoomConfigUpdatePayload;
    [PACKET_TYPES.OWNERSHIP_REQUEST]: IOwnershipRequestPayload;
    [PACKET_TYPES.OWNERSHIP_RELEASE]: IOwnershipReleasePayload;
    [PACKET_TYPES.OWNERSHIP_TRANSFER]: IOwnershipTransferPayload;
    [PACKET_TYPES.AUDIO_CHUNK]: unknown;
    [PACKET_TYPES.PEER_JOINED]: { peerId: string };
    [PACKET_TYPES.FEATURE_EVENT]: IReplicatedFeatureEventPayload;
    [PACKET_TYPES.FEATURE_SNAPSHOT]: IReplicatedFeatureSnapshotPayload;
    [PACKET_TYPES.FEATURE_SNAPSHOT_REQUEST]: IFeatureSnapshotRequestPayload;
    [PACKET_TYPES.DESKTOP_SOURCES_STATUS_REQUEST]: IDesktopSourcesStatusRequestPayload;
    [PACKET_TYPES.DESKTOP_SOURCES_STATUS_RESPONSE]: IDesktopSourcesStatusResponsePayload;
    [PACKET_TYPES.DESKTOP_STREAM_SUMMON]: IDesktopStreamSummonPayload;
    [PACKET_TYPES.DESKTOP_STREAM_STOP]: IDesktopStreamStopPayload;
    [PACKET_TYPES.DESKTOP_STREAM_SUMMONED]: IDesktopStreamSummonedPayload;
    [PACKET_TYPES.DESKTOP_STREAM_STOPPED]: IDesktopStreamStoppedPayload;
    [PACKET_TYPES.DESKTOP_STREAM_OFFLINE]: IDesktopStreamOfflinePayload;
    [PACKET_TYPES.DESKTOP_STREAM_FRAME]: IDesktopStreamFramePayload;
    [PACKET_TYPES.ROOM_NOTIFICATION]: IRoomNotificationPayload;
}

export interface NetworkEnvelope<K extends keyof PacketPayloadMap = keyof PacketPayloadMap> {
    type: K;
    payload: PacketPayloadMap[K];
    senderId?: string;
}
