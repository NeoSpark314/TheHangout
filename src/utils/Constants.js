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

    // Voice Chat
    VOICE_STREAM_RECEIVED: 'VOICE_STREAM_RECEIVED',

    // Render & Logic
    SCENE_READY: 'SCENE_READY',
    PHYSICS_READY: 'PHYSICS_READY',
    LOCAL_PLAYER_MOVED: 'LOCAL_PLAYER_MOVED',
    INTERACTION_TRIGGERED: 'INTERACTION_TRIGGERED'
};

export const PACKET_TYPES = {
    STATE_UPDATE: 0, // Host -> Guests: World state (Transform of all dynamic objects + players)
    PLAYER_INPUT: 1, // Guest -> Host: Controller & Headset positions
    PEER_DISCONNECT: 2, // Host -> Guests: Notification that a peer left
};
