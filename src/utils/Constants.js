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
    NETWORK_DATA_RECEIVED: 'NETWORK_DATA_RECEIVED',

    // Render & Logic
    SCENE_READY: 'SCENE_READY',
    PHYSICS_READY: 'PHYSICS_READY',
    LOCAL_PLAYER_MOVED: 'LOCAL_PLAYER_MOVED',
    INTERACTION_TRIGGERED: 'INTERACTION_TRIGGERED'
};

export const PACKET_TYPES = {
    STATE_UPDATE: 0, // Host -> Guests: World state (Transform of all dynamic objects + players)
    PLAYER_INPUT: 1, // Guest -> Host: Controller & Headset positions
    SPAWN_OBJECT: 2, // Either -> Host: Request to spawn a physics object
    CHAT_MESSAGE: 3, // Broadcast: Text or built-in voice signaling
};

export const PHYSICS_GROUPS = {
    TERRAIN: 1, // 0001
    PLAYER: 2,  // 0010
    PROP: 4,    // 0100
    TRIGGER: 8  // 1000
};
