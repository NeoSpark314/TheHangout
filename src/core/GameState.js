// core/GameState.js

class GameState {
    constructor() {
        this.isHost = false;
        this.isDedicatedHost = false;
        this.isLocalServer = false;
        this.roomId = null;
        this.playerName = 'Player';
        this.avatarConfig = {
            color: '#00ffff' // Default Cyber Cyan
        };
        this.voiceEnabled = false;
        this.roomConfig = {
            environment: 'cyber-stube',
            skyColor: '#0b0c10',
            fogNear: 5,
            fogFar: 1000,
            seed: Math.floor(Math.random() * 2147483647)
        };

        // Entity stores
        this.localPlayer = null;

        // Core Managers
        this.managers = {
            entity: null,
            ui: null,
            network: null,
            media: null,
            render: null,
            physics: null,
            player: null,
            input: null,
            hud: null,
            room: null
        };

        // Timing
        this.deltaTime = 0;
    }
}

const gameState = new GameState();
export default gameState;
