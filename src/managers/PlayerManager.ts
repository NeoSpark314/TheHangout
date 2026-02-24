import { EntityFactory } from '../factories/EntityFactory';
import gameState from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants.js';

export class PlayerManager {
    public initialized: boolean = false;

    constructor() {
        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId: string) => this.onPeerDisconnected(peerId));
    }

    public init(id: string): void {
        const managers = gameState.managers;
        if (gameState.isDedicatedHost) {
            console.log('[PlayerManager] Dedicated Host mode — creating local spectator entity.');
            gameState.localPlayer = EntityFactory.createSpectator(id, true);
            managers.entity.addEntity(gameState.localPlayer);
            this.initialized = true;
            return;
        }

        console.log('[PlayerManager] Initializing Local Player with ID:', id);

        let spawnIndex = 0;
        if (!gameState.isHost) {
            if (managers.room && (managers.room as any).assignedSpawnIndex !== undefined) {
                spawnIndex = (managers.room as any).assignedSpawnIndex;
            } else if (managers.network) {
                spawnIndex = managers.network.connections.size;
            }
        }

        const spawn = (managers.room as any).getSpawnPoint ? (managers.room as any).getSpawnPoint(spawnIndex) : { position: { x: 0, y: 0, z: 0 }, yaw: 0 };

        gameState.localPlayer = EntityFactory.createPlayer(id, {
            isLocal: true,
            spawnPos: spawn.position || { x: 0, y: 0, z: 0 },
            spawnYaw: spawn.yaw || 0,
            color: gameState.avatarConfig.color || 0x00ffff
        }) as any;
        
        if (gameState.localPlayer) {
            (gameState.localPlayer as any).name = gameState.playerName || 'Player';
        }

        managers.entity.addEntity(gameState.localPlayer as any);
        this.initialized = true;
    }

    public onPeerDisconnected(peerId: string): void {
        const managers = gameState.managers;
        const entity = managers.entity.getEntity(peerId);
        
        if (!entity) {
            console.warn(`[PlayerManager] Received disconnect for unknown peer: ${peerId}`);
            return;
        }

        console.log(`[PlayerManager] Removing entity for disconnected peer: ${peerId} (type: ${entity.type})`);
        
        const name = (entity as any).name;
        const isPlayer = entity.type === 'REMOTE_PLAYER' || entity.type === 'LOCAL_PLAYER';

        // Critical: Always trigger destruction and removal
        managers.entity.removeEntity(peerId);

        if (isPlayer && managers.hud) {
            managers.hud.showNotification(`${name || 'A player'} left the hangout.`);
        }
    }
}
