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
        this.initialized = true;
    }

    onPeerConnected(peerId) {
        if (peerId === gameState.roomId && !gameState.isHost) {
            // Don't spawn an avatar merely for the host connection itself if it's the signaling server
            // Wait, the host is a player too in a P2P mesh! 
        }

        // For now, spawn a basic remote player stub
        console.log(`[PlayerManager] Spawning remote player for ${peerId}`);
        const rp = new RemotePlayer(peerId);
        gameState.remotePlayers.set(peerId, rp);
    }

    onPeerDisconnected(peerId) {
        console.log(`[PlayerManager] Removing remote player for ${peerId}`);
        // Cleanup Three.js meshes and Rapier bodies later
        gameState.remotePlayers.delete(peerId);
    }

    update(delta) {
        // Note: The GameEngine loop already calls update on localPlayer and remotePlayers.
        // The PlayerManager update loop is for high-level manager tasks, which currently is empty.
    }

    onNetworkData({ senderId, type, data }) {
        if (type === 'INPUT') {
            let rp = gameState.remotePlayers.get(senderId);

            // If we receive input from a peer we haven't spawned yet, spawn them!
            if (!rp && senderId !== gameState.managers.network.peer?.id) {
                this.onPeerConnected(senderId);
                rp = gameState.remotePlayers.get(senderId);
            }

            if (rp) {
                rp.setTargetState(data);
            }

            // If we are Host, we must relay this input to all OTHER guests so everyone sees everyone!
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
