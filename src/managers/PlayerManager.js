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
        eventBus.on(EVENTS.NETWORK_DATA_RECEIVED, (e) => this.onNetworkData(e));
    }

    init() {
        console.log('[PlayerManager] Initializing Local Player');
        gameState.localPlayer = new LocalPlayer();

        // Register the local player with the EntityManager.
        // It's assigned a temporary ID until NetworkManager assigns a real peer ID if hosting/joining.
        gameState.managers.entity.addEntity(gameState.localPlayer);

        this.initialized = true;
    }

    onPeerConnected(peerId) {
        if (peerId === gameState.roomId && !gameState.isHost) {
            // Don't spawn an avatar merely for the host connection itself if it's the signaling server
            // Wait, the host is a player too in a P2P mesh! 
        }

        console.log(`[PlayerManager] Spawning remote player for ${peerId}`);
        const rp = new RemotePlayer(peerId);

        // Use EntityManager instead of manual map
        gameState.managers.entity.addEntity(rp);

        // Keep the legacy map updated just in case other systems (like UI) rely on it
        gameState.remotePlayers.set(peerId, rp);
    }

    onPeerDisconnected(peerId) {
        console.log(`[PlayerManager] Removing remote player for ${peerId}`);
        gameState.managers.entity.removeEntity(peerId);
        gameState.remotePlayers.delete(peerId);
    }

    update(delta) {
        // PlayerManager update loop is for high-level manager tasks.
    }

    onNetworkData({ senderId, type, data }) {
        // We will move generic state sync out of here entirely to NetworkManager.
        // This method can be removed or used for Player-Manager specific events like "Player Name Changed".

        // As a temporary fallback until NetworkManager is fully refactored, we route FACE updates here
        // or let NetworkManager handle it genericly later.
        if (type === 'FACE') {
            const rp = gameState.managers.entity.getEntity(senderId);
            if (rp && rp.type === 'REMOTE_PLAYER') {
                rp.setFace(data);
            }

            // Host relays face updates
            if (gameState.isHost) {
                for (const [peerId, conn] of gameState.managers.network.connections.entries()) {
                    if (conn.open && peerId !== senderId) {
                        gameState.managers.network.sendData(peerId, type, data);
                    }
                }
            }
        }
    }
}
