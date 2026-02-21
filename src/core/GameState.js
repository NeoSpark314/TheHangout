// core/GameState.js

class GameState {
    constructor() {
        this.isHost = false;
        this.roomId = null;
        this.playerName = 'Player';

        // Entity stores
        this.localPlayer = null;
        this.remotePlayers = new Map(); // peerId -> RemotePlayer
        this.interactables = new Map(); // objectId -> Interactable

        // Core Managers
        this.managers = {
            network: null,
            physics: null,
            render: null,
            world: null,
            entity: null,
            ui: null,
            player: null,
            interaction: null,
            asset: null,
        };

        // Timing
        this.clock = null;
        this.deltaTime = 0;
    }
}

const gameState = new GameState();
export default gameState;
