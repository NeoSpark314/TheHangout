import '../style.css';
import { GameEngine } from './core/GameEngine';
import gameState from './core/GameState';
import { UIManager } from './managers/UIManager';
import { NetworkManager } from './network/NetworkManager';
import { PhysicsManager } from './managers/PhysicsManager';
import { RenderManager } from './managers/RenderManager';
import { PlayerManager } from './managers/PlayerManager';
import { EntityManager } from './managers/EntityManager';
import { MediaManager } from './managers/MediaManager';
import { HUDManager } from './managers/HUDManager';
import { InputManager } from './input/InputManager';
import { RoomManager } from './managers/RoomManager';
import { AudioManager } from './managers/AudioManager';
import { InteractionSystem } from './systems/InteractionSystem';
import { EntityFactory } from './factories/EntityFactory';
import eventBus from './core/EventBus';
import { EVENTS } from './utils/Constants';

async function bootstrap() {
  console.log('Bootstrapping TheHangout...');

  try {
    const resp = await fetch('/api/server-info');
    if (resp.ok) {
      const info = await resp.json();
      if (info.local) {
        gameState.isLocalServer = true;
        console.log('[Bootstrap] Local server detected — using local PeerJS signaling.');
      }
    }
  } catch (e) {}

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
  gameState.managers.audio = new AudioManager();
  gameState.managers.interaction = new InteractionSystem(gameState.managers.entity);

  const resumeAudio = () => {
    gameState.managers.audio?.resume();
    window.removeEventListener('pointerdown', resumeAudio);
    window.removeEventListener('keydown', resumeAudio);
  };
  window.addEventListener('pointerdown', resumeAudio);
  window.addEventListener('keydown', resumeAudio);

  if (gameState.managers.render && gameState.managers.hud) {
    gameState.managers.render.camera.add(gameState.managers.hud.group);
  }

  if (gameState.managers.physics) {
    await gameState.managers.physics.init();
  }

  let playerInitialized = false;
  const initPlayerOnce = (id: string) => {
    if (playerInitialized || !id) return;
    playerInitialized = true;

    if (gameState.isDedicatedHost) {
      gameState.managers.render?.switchToSpectatorView();
      const spectator = EntityFactory.createSpectator(id, true);
      gameState.managers.entity?.addEntity(spectator);
    } else {
      gameState.managers.render?.switchToPlayerView();
      gameState.managers.player?.init(id);
    }
  };

  eventBus.on(EVENTS.HOST_READY, (id: string) => initPlayerOnce(id));
  eventBus.on(EVENTS.PEER_CONNECTED, (peerId: string) => {
    const localId = (gameState.managers.network as any).peer?.id;
    if (!gameState.isHost && localId) {
      initPlayerOnce(localId);
    }
  });

  if (gameState.managers.render && gameState.managers.room) {
    gameState.managers.room.init(gameState.managers.render.scene);
  }

  const engine = new GameEngine();
  await engine.initialize();
  eventBus.emit(EVENTS.SCENE_READY);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
});
