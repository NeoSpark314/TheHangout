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
        if (gameState.isDedicatedHost) {
            console.log('[PlayerManager] Dedicated Host mode — skipping local player init.');
            this.initialized = true;
            return;
        }

        console.log('[PlayerManager] Initializing Local Player with ID:', id);

        // Get procedural spawn point
        let spawnIndex = 0; // Host is always 0
        if (!gameState.isHost) {
            // Guests are indexed based on their order in connections
            spawnIndex = gameState.managers.network.connections.size;
        }

        const spawn = gameState.managers.room.getSpawnPoint(spawnIndex);

        gameState.localPlayer = new LocalPlayer(id, spawn.position, spawn.yaw);

        // Register the local player with the EntityManager.
        gameState.managers.entity.addEntity(gameState.localPlayer);

        this.initialized = true;
    }

    onPeerConnected(peerId) {
        // Don't spawn a RemotePlayer for the dedicated host — they have no avatar
        if (gameState.roomConfig?.isDedicatedHost && peerId === gameState.roomId) {
            console.log(`[PlayerManager] Skipping avatar for dedicated host ${peerId}`);
            return;
        }

        console.log(`[PlayerManager] Spawning remote player for ${peerId}`);
        const rp = new RemotePlayer(peerId);

        // Remote players will be positioned by their network state, 
        // so we don't strictly need to set spawn point here, 
        // but it helps if we wanted an instant visual placeholder.

        // Use EntityManager instead of manual map
        gameState.managers.entity.addEntity(rp);
    }

    onPeerDisconnected(peerId) {
        console.log(`[PlayerManager] Removing remote player for ${peerId}`);
        const entity = gameState.managers.entity.getEntity(peerId);
        const name = entity ? (entity.name || 'Somebody') : 'Somebody';

        gameState.managers.entity.removeEntity(peerId);

        if (gameState.managers.hud) {
            gameState.managers.hud.showNotification(`${name} left the hangout.`);
        }
    }

}
