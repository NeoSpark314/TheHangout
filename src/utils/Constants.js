// utils/Constants.js

export const EVENTS = {
    // UI Events
    START_XR: 'START_XR',
    JOIN_ROOM: 'JOIN_ROOM',
    CREATE_ROOM: 'CREATE_ROOM',
    // Network Events
    HOST_READY: 'HOST_READY',
    PEER_CONNECTED: 'PEER_CONNECTED',
    PEER_DISCONNECTED: 'PEER_DISCONNECTED',
    ASSET_LOADED: 'ASSET_LOADED',
    ASSET_LOAD_ERROR: 'ASSET_LOAD_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    HOST_DISCONNECTED: 'HOST_DISCONNECTED',
    LOCAL_NAME_UPDATED: 'LOCAL_NAME_UPDATED',
    REMOTE_NAME_UPDATED: 'REMOTE_NAME_UPDATED',
    AVATAR_CONFIG_UPDATED: 'AVATAR_CONFIG_UPDATED',

    // Voice Chat
    VOICE_STREAM_RECEIVED: 'VOICE_STREAM_RECEIVED',

    // Render & Logic
    SCENE_READY: 'SCENE_READY',
    PHYSICS_READY: 'PHYSICS_READY',
    LOCAL_PLAYER_MOVED: 'LOCAL_PLAYER_MOVED',
    OWNERSHIP_TRANSFERRED: 'OWNERSHIP_TRANSFERRED'
};

export const PACKET_TYPES = {
    STATE_UPDATE: 0, // Host -> Guests: World state (Transform of all dynamic objects + players)
    PLAYER_INPUT: 1, // Guest -> Host: Controller & Headset positions
    PEER_DISCONNECT: 2, // Host -> Guests: Notification that a peer left
    ROOM_CONFIG_UPDATE: 3,
    OWNERSHIP_REQUEST: 4,  // Guest -> Host: request to own an object
    OWNERSHIP_RELEASE: 5,  // Guest -> Host: release ownership + final velocity
    OWNERSHIP_TRANSFER: 6  // Host -> Guests: notify everyone of new owner
};

export const INPUT_CONFIG = {
    GAMEPAD_LOOK_SENSITIVITY: 1.5,
    MOBILE_LOOK_SENSITIVITY: 0.6,
    DEADZONE: 0.15
};
