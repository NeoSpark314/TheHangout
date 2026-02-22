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

    onPeerConnected(peerId) {
        // [SYNC FIX] REFINED JOIN SEQUENCE:
        // If we are a guest, and this is the host connecting, STOP eager spawning.
        // We wait for the Host to send its first state update packet to determine 
        // if it's a PLAYER (RemotePlayer) or a SPECTATOR (Dedicated Host).
        if (!gameState.isHost && peerId === gameState.roomId) {
            console.log(`[PlayerManager] Deferring avatar spawn for host ${peerId} until state update.`);
            return;
        }

        console.log(`[PlayerManager] Spawning remote player for ${peerId}`);

        // Create entity via factory
        const rp = EntityFactory.createPlayer(peerId, {
            isLocal: false,
            color: 0xff00ff
        });

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
