import { IStateUpdatePacket } from '../../shared/contracts/IEntityState';
import {
    IDesktopSourcesStatusRequestPayload,
    IDesktopSourcesStatusResponsePayload,
    IDesktopStreamFramePayload,
    IDesktopStreamOfflinePayload,
    IDesktopStreamStopPayload,
    IDesktopStreamStoppedPayload,
    IDesktopStreamSummonPayload,
    IDesktopStreamSummonedPayload,
    ISessionNotificationPayload,
    IFeatureSnapshotRequestPayload,
    IOwnershipReleasePayload,
    IOwnershipRequestPayload,
    IOwnershipTransferPayload,
    IPeerDisconnectPayload,
    ISessionConfigUpdatePayload
} from '../../shared/contracts/INetworkPacket';
import { IAudioChunkPayload } from '../../shared/contracts/IVoice';
import { IReplicatedFeatureEventPayload, IReplicatedFeatureSnapshotPayload } from '../replication/FeatureReplicationService';
import { PACKET_TYPES } from '../../shared/constants/Constants';

export interface PacketPayloadMap {
    [PACKET_TYPES.STATE_UPDATE]: IStateUpdatePacket[];
    [PACKET_TYPES.PLAYER_INPUT]: IStateUpdatePacket[];
    [PACKET_TYPES.PEER_DISCONNECT]: string | IPeerDisconnectPayload;
    [PACKET_TYPES.SESSION_CONFIG_UPDATE]: ISessionConfigUpdatePayload;
    [PACKET_TYPES.OWNERSHIP_REQUEST]: IOwnershipRequestPayload;
    [PACKET_TYPES.OWNERSHIP_RELEASE]: IOwnershipReleasePayload;
    [PACKET_TYPES.OWNERSHIP_TRANSFER]: IOwnershipTransferPayload;
    [PACKET_TYPES.AUDIO_CHUNK]: IAudioChunkPayload;
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
    [PACKET_TYPES.SESSION_NOTIFICATION]: ISessionNotificationPayload;
}

export interface NetworkEnvelope<K extends keyof PacketPayloadMap = keyof PacketPayloadMap> {
    type: K;
    payload: PacketPayloadMap[K];
    senderId?: string;
}
