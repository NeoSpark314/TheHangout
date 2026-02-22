// main.js
import '../style.css';
import { GameEngine } from './core/GameEngine.js';
import gameState from './core/GameState.js';
import { UIManager } from './managers/UIManager.js';
import { NetworkManager } from './managers/NetworkManager.js';
import { PhysicsManager } from './managers/PhysicsManager.js';
import { RenderManager } from './managers/RenderManager.js';
import { PlayerManager } from './managers/PlayerManager.js';
import { EntityManager } from './managers/EntityManager.js';
import { MediaManager } from './managers/MediaManager.js';
import { HUDManager } from './managers/HUDManager.js';
import { InputManager } from './managers/InputManager.js';
import { RoomManager } from './managers/RoomManager.js';
import { SpectatorEntity } from './entities/SpectatorEntity.js';
import eventBus from './core/EventBus.js';
import { EVENTS } from './utils/Constants.js';

async function bootstrap() {
  console.log('Bootstrapping TheHangout...');

  // Initialize Managers
  gameState.managers.entity = new EntityManager();
  gameState.managers.ui = new UIManager();
  gameState.managers.network = new NetworkManager();
  gameState.managers.media = new MediaManager();
  gameState.managers.render = new RenderManager();
  gameState.managers.physics = new PhysicsManager();
  gameState.managers.player = new PlayerManager();
  gameState.managers.input = new InputManager();
  gameState.managers.hud = new HUDManager();
  gameState.managers.room = new RoomManager();

  // Attach HUD to camera
  if (gameState.managers.render) {
    gameState.managers.render.camera.add(gameState.managers.hud.group);
  }

  // Wait for Physics
  await gameState.managers.physics.init();

  let playerInitialized = false;
  const initPlayerOnce = (id) => {
    if (playerInitialized) return;
    if (!id) return;
    playerInitialized = true;

    // Stop cinematic menu rotation
    if (gameState.isDedicatedHost) {
      gameState.managers.render.switchToSpectatorView();
      const spectator = new SpectatorEntity(id, true);
      gameState.managers.entity.addEntity(spectator);
    } else {
      gameState.managers.render.switchToPlayerView();
      gameState.managers.player.init(id);
    }
  };

  eventBus.on(EVENTS.HOST_READY, (id) => initPlayerOnce(id));
  eventBus.on(EVENTS.PEER_CONNECTED, (peerId) => {
    // If we are a guest, we connect to the host. PEER_CONNECTED fires when the connection opens.
    // However, we need our OWN id for the local player.
    // Fortunately, NetworkManager assigns the local peer ID to gameState.roomId as soon as 'open' fires.
    // Wait, actually NetworkManager has the peer ID as this.peer.id.
    const localId = gameState.managers.network.peer?.id;
    if (!gameState.isHost && localId) {
      initPlayerOnce(localId);
    }
  });


  // Initialize Room (Atmosphere)
  if (gameState.managers.render) {
    gameState.managers.room.init(gameState.managers.render.scene);
  }

  // Initialize and load Engine
  const engine = new GameEngine();
  await engine.initialize();
  // Engine automatically listens for SCENE_READY to start its loop

  // Signal Engine we are ready
  eventBus.emit(EVENTS.SCENE_READY);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
});
