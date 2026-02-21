// managers/PlayerManager.js
import { LocalPlayer } from '../entities/LocalPlayer.js';
import { RemotePlayer } from '../entities/RemotePlayer.js';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

export class PlayerManager {
    constructor() {
        this.initialized = false;

        // Listen to network events to spawn/despawn remote avatars
        eventBus.on(EVENTS.PEER_CONNECTED, (peerId) => this.onPeerConnected(peerId));
        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId) => this.onPeerDisconnected(peerId));
    }

    init(id) {
        console.log('[PlayerManager] Initializing Local Player with ID:', id);
        gameState.localPlayer = new LocalPlayer(id);

        // Register the local player with the EntityManager.
        // It's assigned a temporary ID until NetworkManager assigns a real peer ID if hosting/joining.
        gameState.managers.entity.addEntity(gameState.localPlayer);

        this.initialized = true;
    }

    onPeerConnected(peerId) {


        console.log(`[PlayerManager] Spawning remote player for ${peerId}`);
        const rp = new RemotePlayer(peerId);

        // Use EntityManager instead of manual map
        gameState.managers.entity.addEntity(rp);
    }

    onPeerDisconnected(peerId) {
        console.log(`[PlayerManager] Removing remote player for ${peerId}`);
        gameState.managers.entity.removeEntity(peerId);
    }

}
