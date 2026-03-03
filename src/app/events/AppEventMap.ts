import type { IAvatarConfig } from '../AppContext';
import type { IOwnershipReleasePayload, IOwnershipRequestPayload } from '../../shared/contracts/INetworkPacket';
import type { IHandIntentPayload, ILookIntentPayload, IMoveIntentPayload, IVRSnapTurnPayload } from '../../shared/contracts/IIntents';
import type { IVector3 } from '../../shared/contracts/IMath';
import type { IVoiceStreamReceivedEvent } from '../../shared/contracts/IVoice';

/**
 * Global app-wide events only.
 *
 * Architectural boundary:
 * - Keep cross-cutting infrastructure here (session lifecycle, input intents,
 *   ownership requests, shared UI/system notifications, voice plumbing).
 * - Do not add session-specific or item-specific domain events here. Those belong
 *   inside feature/session runtime and should use feature-local APIs plus
 *   FeatureReplicationService for network fan-out.
 */
export interface AppEventMap {
    START_XR: void;
    JOIN_SESSION: string;
    CREATE_SESSION: string;
    HOST_READY: string;
    SESSION_CONNECTED: string;
    ENTITY_DISCOVERED: string;
    PEER_DISCONNECTED: string;
    ASSET_LOADED: unknown; // Reserved until asset loading emits a stable shared payload.
    ASSET_LOAD_ERROR: unknown; // Reserved until asset loading emits a stable shared payload.
    NETWORK_ERROR: string;
    HOST_DISCONNECTED: void;
    LOCAL_NAME_UPDATED: string;
    REMOTE_NAME_UPDATED: { peerId: string; name: string };
    PEER_STATE_UPDATED: string;
    AVATAR_CONFIG_UPDATED: IAvatarConfig;
    VOICE_STREAM_RECEIVED: IVoiceStreamReceivedEvent;
    SCENE_READY: void;
    PHYSICS_READY: void;
    AUDIO_READY: void;
    LOCAL_PLAYER_MOVED: unknown; // Reserved until movement broadcasts a stable shared payload.
    OWNERSHIP_TRANSFERRED: unknown; // Reserved until a distinct app-level transfer event is reintroduced.
    ENTITY_COLLIDED: { intensity: number };
    PHYSICS_COLLISION_STARTED: { handleA: number; handleB: number; entityAId: string | null; entityBId: string | null };
    REQUEST_OWNERSHIP: IOwnershipRequestPayload;
    RELEASE_OWNERSHIP: IOwnershipReleasePayload;
    RECLAIM_OWNERSHIP: void;
    SYSTEM_NOTIFICATION: string;
    AUDIO_CHUNK_RECEIVED: unknown;
    PEER_JOINED_SESSION: string;
    XR_SESSION_STARTED: void;
    XR_SESSION_ENDED: void;
    VOICE_STATE_UPDATED: void;
    SOCIAL_HIGH_FIVE: { position?: IVector3; intensity: number };
    DESKTOP_SCREENS_UPDATED: void;
    INTENT_MOVE: IMoveIntentPayload;
    INTENT_LOOK: ILookIntentPayload;
    INTENT_INTERACT_START: IHandIntentPayload;
    INTENT_INTERACT_END: IHandIntentPayload;
    INTENT_GRAB_START: IHandIntentPayload;
    INTENT_GRAB_END: IHandIntentPayload;
    INTENT_VR_SNAP_TURN: IVRSnapTurnPayload;
}
