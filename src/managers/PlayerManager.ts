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

    public handleRemoteEntityDiscovery(peerId: string, type: string): void {
        const managers = gameState.managers;
        if (managers.entity.getEntity(peerId)) return;

        console.log(`[PlayerManager] Discovering remote ${type} for ${peerId}`);

        if (type === 'LOCAL_PLAYER' || type === 'REMOTE_PLAYER') {
            const rp = EntityFactory.createPlayer(peerId, {
                isLocal: false,
                spawnPos: { x: 0, y: 0, z: 0 },
                spawnYaw: 0,
                color: 0xff00ff
            });
            managers.entity.addEntity(rp);
        } else if (type === 'SPECTATOR') {
            const rs = EntityFactory.createSpectator(peerId, false);
            managers.entity.addEntity(rs);
        }

        eventBus.emit(EVENTS.PEER_CONNECTED, peerId);
    }

    public onPeerDisconnected(peerId: string): void {
        const managers = gameState.managers;
        const entity = managers.entity.getEntity(peerId);
        if (!entity || entity.type === 'SPECTATOR') {
            managers.entity.removeEntity(peerId);
            return;
        }

        console.log(`[PlayerManager] Removing remote player for ${peerId}`);
        const name = (entity as any).name || 'Somebody';

        managers.entity.removeEntity(peerId);

        if (managers.hud) {
            managers.hud.showNotification(`${name} left the hangout.`);
        }
    }
}
