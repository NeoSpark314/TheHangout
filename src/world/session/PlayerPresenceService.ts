import { EntityFactory } from '../spawning/EntityFactory';
import { GameContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants.js';

export class PlayerManager {
    public isInitialized: boolean = false;

    constructor(private context: GameContext) {
        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId: string) => this.onPeerDisconnected(peerId));
    }

    public init(id: string): void {
        const managers = this.context.managers;

        console.log('[PlayerManager] Initializing Local Player with ID:', id);

        let spawnIndex = 0;
        if (!this.context.isHost) {
            if (managers.session && (managers.session as any).assignedSpawnIndex !== undefined) {
                spawnIndex = (managers.session as any).assignedSpawnIndex;
            } else if (managers.network) {
                spawnIndex = managers.network.connections.size;
            }
        }

        const spawn = (managers.session as any).getSpawnPoint ? (managers.session as any).getSpawnPoint(spawnIndex) : { position: { x: 0, y: 0, z: 0 }, yaw: 0 };

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
