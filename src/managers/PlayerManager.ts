import { EntityFactory } from '../factories/EntityFactory';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants.js';

export class PlayerManager {
    public isInitialized: boolean = false;

    constructor(private context: GameContext) {
        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId: string) => this.onPeerDisconnected(peerId));
    }

    public init(id: string): void {
        const managers = this.context.managers;
        if (this.context.isDedicatedHost) {
            console.log('[PlayerManager] Dedicated Host mode — creating local spectator entity.');
            this.context.localPlayer = EntityFactory.createSpectator(this.context, id, true);
            managers.entity.addEntity(this.context.localPlayer);
            this.isInitialized = true;
            return;
        }

        console.log('[PlayerManager] Initializing Local Player with ID:', id);

        let spawnIndex = 0;
        if (!this.context.isHost) {
            if (managers.room && (managers.room as any).assignedSpawnIndex !== undefined) {
                spawnIndex = (managers.room as any).assignedSpawnIndex;
            } else if (managers.network) {
                spawnIndex = managers.network.connections.size;
            }
        }

        const spawn = (managers.room as any).getSpawnPoint ? (managers.room as any).getSpawnPoint(spawnIndex) : { position: { x: 0, y: 0, z: 0 }, yaw: 0 };

        this.context.localPlayer = EntityFactory.createPlayer(this.context, id, {
            isLocal: true,
            spawnPos: spawn.position || { x: 0, y: 0, z: 0 },
            spawnYaw: spawn.yaw || 0,
            color: this.context.avatarConfig.color || 0x00ffff
        }) as any;

        if (this.context.localPlayer) {
            (this.context.localPlayer as any).name = this.context.playerName || 'Player';
        }

        managers.animation.setLocalPlayer(this.context.localPlayer as any, managers);
        managers.entity.addEntity(this.context.localPlayer as any);
        this.isInitialized = true;
    }

    public onPeerDisconnected(peerId: string): void {
        const managers = this.context.managers;
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
