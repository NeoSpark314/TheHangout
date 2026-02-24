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
        if (gameState.isDedicatedHost) {
            console.log('[PlayerManager] Dedicated Host mode — creating local spectator entity.');
            gameState.localPlayer = EntityFactory.createSpectator(id, true);
            gameState.managers.entity?.addEntity(gameState.localPlayer);
            this.initialized = true;
            return;
        }

        console.log('[PlayerManager] Initializing Local Player with ID:', id);

        let spawnIndex = 0;
        if (!gameState.isHost) {
            if (gameState.managers.room && (gameState.managers.room as any).assignedSpawnIndex !== undefined) {
                spawnIndex = (gameState.managers.room as any).assignedSpawnIndex;
            } else if (gameState.managers.network) {
                spawnIndex = (gameState.managers.network as any).connections.size;
            }
        }

        const spawn = (gameState.managers.room as any).getSpawnPoint(spawnIndex);

        gameState.localPlayer = EntityFactory.createPlayer(id, {
            isLocal: true,
            spawnPos: spawn.position,
            spawnYaw: spawn.yaw,
            color: gameState.avatarConfig.color || 0x00ffff
        });

        gameState.managers.entity?.addEntity(gameState.localPlayer);
        this.initialized = true;
    }

    public handleRemoteEntityDiscovery(peerId: string, type: string): void {
        if (gameState.managers.entity?.getEntity(peerId)) return;

        console.log(`[PlayerManager] Discovering remote ${type} for ${peerId}`);

        if (type === 'LOCAL_PLAYER' || type === 'REMOTE_PLAYER') {
            const rp = EntityFactory.createPlayer(peerId, {
                isLocal: false,
                color: 0xff00ff
            });
            gameState.managers.entity?.addEntity(rp);
        } else if (type === 'SPECTATOR') {
            const rs = EntityFactory.createSpectator(peerId, false);
            gameState.managers.entity?.addEntity(rs);
        }

        eventBus.emit(EVENTS.PEER_CONNECTED, peerId);
    }

    public onPeerDisconnected(peerId: string): void {
        const entity = gameState.managers.entity?.getEntity(peerId);
        if (!entity || entity.type === 'SPECTATOR') {
            gameState.managers.entity?.removeEntity(peerId);
            return;
        }

        console.log(`[PlayerManager] Removing remote player for ${peerId}`);
        const name = (entity as any).name || 'Somebody';

        gameState.managers.entity?.removeEntity(peerId);

        if (gameState.managers.hud) {
            (gameState.managers.hud as any).showNotification(`${name} left the hangout.`);
        }
    }
}
