// managers/PlayerManager.js

import { EntityFactory } from '../factories/EntityFactory.js';
import gameState from '../core/GameState.js';
import eventBus from '../core/EventBus.js';
import { EVENTS } from '../utils/Constants.js';

/**
 * Manages player lifecycle: spawns/despawns local and remote player entities.
 *
 * Uses EntityFactory to create entities with their associated views.
 */
export class PlayerManager {
    constructor() {
        this.initialized = false;
        // Spawning is now data-driven via NetworkManager calling handleRemoteEntityDiscovery
        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId) => this.onPeerDisconnected(peerId));
    }

    init(id) {
        if (gameState.isDedicatedHost) {
            console.log('[PlayerManager] Dedicated Host mode — creating local spectator entity.');
            // Dedicated host needs an entity so guests can "see" it and finish joining
            gameState.localPlayer = EntityFactory.createSpectator(id, true);
            gameState.managers.entity.addEntity(gameState.localPlayer);
            this.initialized = true;
            return;
        }

        console.log('[PlayerManager] Initializing Local Player with ID:', id);

        // Get procedural spawn point
        let spawnIndex = 0; // Host is always 0
        if (!gameState.isHost) {
            spawnIndex = gameState.managers.network.connections.size;
        }

        const spawn = gameState.managers.room.getSpawnPoint(spawnIndex);

        // Create entity via factory
        gameState.localPlayer = EntityFactory.createPlayer(id, {
            isLocal: true,
            spawnPos: spawn.position,
            spawnYaw: spawn.yaw,
            color: gameState.avatarConfig.color || 0x00ffff
        });

        gameState.managers.entity.addEntity(gameState.localPlayer);
        this.initialized = true;
    }

    /**
     * Data-driven entry point for new entities discovered via network state.
     */
    handleRemoteEntityDiscovery(peerId, type) {
        if (gameState.managers.entity.getEntity(peerId)) return;

        console.log(`[PlayerManager] Discovering remote ${type} for ${peerId}`);

        if (type === 'LOCAL_PLAYER' || type === 'REMOTE_PLAYER') {
            const rp = EntityFactory.createPlayer(peerId, {
                isLocal: false,
                color: 0xff00ff
            });
            gameState.managers.entity.addEntity(rp);
        } else if (type === 'SPECTATOR') {
            const rs = EntityFactory.createSpectator(peerId, false);
            gameState.managers.entity.addEntity(rs);
        }

        // Notify UI that we've "connected" to something tangible
        eventBus.emit(EVENTS.PEER_CONNECTED, peerId);
    }

    onPeerDisconnected(peerId) {
        const entity = gameState.managers.entity.getEntity(peerId);
        if (!entity || entity.type === 'SPECTATOR') {
            gameState.managers.entity.removeEntity(peerId);
            return; // No notification for non-players or non-existent
        }

        console.log(`[PlayerManager] Removing remote player for ${peerId}`);
        const name = entity.name || 'Somebody';

        gameState.managers.entity.removeEntity(peerId);

        if (gameState.managers.hud) {
            gameState.managers.hud.showNotification(`${name} left the hangout.`);
        }
    }
}
