// main.js
import './style.css';
import { GameEngine } from './core/GameEngine.js';
import gameState from './core/GameState.js';
import { UIManager } from './managers/UIManager.js';
import { NetworkManager } from './managers/NetworkManager.js';
import { PhysicsManager } from './managers/PhysicsManager.js';
import { RenderManager } from './managers/RenderManager.js';
import { WorldManager } from './managers/WorldManager.js';
import { PlayerManager } from './managers/PlayerManager.js';
import { EntityManager } from './managers/EntityManager.js';
import { DebugUIManager } from './managers/DebugUIManager.js';
import { MediaManager } from './managers/MediaManager.js';
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
  gameState.managers.world = new WorldManager();
  gameState.managers.player = new PlayerManager();

  // Wait for Physics
  await gameState.managers.physics.init();

  // Initialize Local Player (Deferred until room join/create)
  // gameState.managers.player.init();

  let playerInitialized = false;
  const initPlayerOnce = (id) => {
    if (playerInitialized) return;
    if (!id) return;
    playerInitialized = true;
    gameState.managers.player.init(id);
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

  // Initialize Debug UI (Needs Local Player's headPose eventually, but can start now)
  gameState.managers.debugUI = new DebugUIManager();
  if (gameState.managers.render) {
    gameState.managers.debugUI.attachTo(gameState.managers.render.camera);
  }

  // Generate World
  gameState.managers.world.generateTestWorld();

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
