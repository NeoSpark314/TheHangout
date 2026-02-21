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
import eventBus from './core/EventBus.js';
import { EVENTS } from './utils/Constants.js';

async function bootstrap() {
  console.log('Bootstrapping TheHangout...');

  // Initialize Managers
  gameState.managers.ui = new UIManager();
  gameState.managers.network = new NetworkManager();
  gameState.managers.render = new RenderManager();
  gameState.managers.physics = new PhysicsManager();
  gameState.managers.world = new WorldManager();
  gameState.managers.player = new PlayerManager();

  // Wait for Physics
  await gameState.managers.physics.init();

  // Initialize Local Player (Needs Physics and Render)
  gameState.managers.player.init();

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
