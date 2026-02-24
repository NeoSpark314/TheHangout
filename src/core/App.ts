import gameState from './GameState';
import { GameEngine } from './GameEngine';
import { UIManager } from '../managers/UIManager';
import { NetworkManager } from '../network/NetworkManager';
import { PhysicsManager } from '../managers/PhysicsManager';
import { RenderManager } from '../managers/RenderManager';
import { PlayerManager } from '../managers/PlayerManager';
import { EntityManager } from '../managers/EntityManager';
import { MediaManager } from '../managers/MediaManager';
import { HUDManager } from '../managers/HUDManager';
import { InputManager } from '../input/InputManager';
import { RoomManager } from '../managers/RoomManager';
import { AudioManager } from '../managers/AudioManager';
import { InteractionSystem } from '../systems/InteractionSystem';
import { XRSystem } from '../systems/XRSystem';
import { AssetManager } from '../managers/AssetManager';
import { DrawingManager } from '../managers/DrawingManager';
import eventBus from './EventBus';
import { EVENTS } from '../utils/Constants';

/**
 * Orchestrates the application lifecycle: Initialization, Bootstrapping, and Shutdown.
 */
export class App {
    private engine: GameEngine;

    constructor() {
        this.engine = new GameEngine();
    }

    public async bootstrap(): Promise<void> {
        console.log('[App] Bootstrapping...');

        try {
            await this.detectServerInfo();
            this.initializeManagers();
            this.setupGlobalEventListeners();
            
            // 1. Infrastructure (Physics must be first)
            await gameState.managers.physics.init();
            
            // 2. World (Requires Physics)
            await this.initSystems();
            
            // 3. Engine (Starts simulation)
            await this.engine.initialize();

            console.log('[App] Bootstrap complete. Scene ready.');
            eventBus.emit(EVENTS.SCENE_READY);
        } catch (error) {
            console.error('[App] Fatal error during bootstrap:', error);
            throw error;
        }
    }

    private async detectServerInfo(): Promise<void> {
        try {
            const resp = await fetch('/api/server-info');
            if (resp.ok) {
                const info = await resp.json();
                if (info.local) {
                    gameState.isLocalServer = true;
                    console.log('[App] Local server detected — using local PeerJS signaling.');
                }
            }
        } catch (e) {
            // Silence: server-info is optional
        }
    }

    private initializeManagers(): void {
        gameState.setManager('entity', new EntityManager());
        gameState.setManager('ui', new UIManager());
        gameState.setManager('network', new NetworkManager());
        gameState.setManager('media', new MediaManager());
        gameState.setManager('render', new RenderManager());
        gameState.setManager('physics', new PhysicsManager());
        gameState.setManager('player', new PlayerManager());
        gameState.setManager('input', new InputManager());
        gameState.setManager('hud', new HUDManager());
        gameState.setManager('room', new RoomManager());
        gameState.setManager('audio', new AudioManager());
        gameState.setManager('assets', new AssetManager());
        gameState.setManager('drawing', new DrawingManager(gameState.managers.render.scene));
        gameState.setManager('xr', new XRSystem());
        gameState.setManager('interaction', new InteractionSystem(gameState.managers.entity));
    }

    private setupGlobalEventListeners(): void {
        const managers = gameState.managers;

        // Audio Activation
        const resumeAudio = () => {
            managers.audio.resume();
            window.removeEventListener('pointerdown', resumeAudio);
            window.removeEventListener('keydown', resumeAudio);
        };
        window.addEventListener('pointerdown', resumeAudio);
        window.addEventListener('keydown', resumeAudio);

        // HUD/Camera integration
        if (managers.render && managers.hud) {
            managers.render.camera.add(managers.hud.group);
        }

        // Network/Player Initialization
        eventBus.on(EVENTS.HOST_READY, (id: string) => this.initPlayerOnce(id));
        eventBus.on(EVENTS.PEER_CONNECTED, (peerId: string) => {
            const localId = (managers.network as any).peer?.id;
            if (!gameState.isHost && localId) {
                this.initPlayerOnce(localId);
            }
        });
    }

    private async initSystems(): Promise<void> {
        const managers = gameState.managers;

        if (managers.render && managers.room) {
            managers.room.init(managers.render.scene);
        }
    }

    private playerInitialized = false;
    private initPlayerOnce(id: string): void {
        if (this.playerInitialized || !id) return;
        this.playerInitialized = true;

        const managers = gameState.managers;
        if (gameState.isDedicatedHost) {
            managers.render.switchToSpectatorView();
        } else {
            managers.render.switchToPlayerView();
        }
        
        managers.player.init(id);
    }
}
