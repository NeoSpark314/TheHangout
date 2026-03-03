import { EntityFactory } from '../spawning/EntityFactory';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants.js';

export class PlayerPresenceService {
    public isInitialized: boolean = false;

    constructor(private context: AppContext) {
        eventBus.on(EVENTS.PEER_DISCONNECTED, (peerId: string) => this.onPeerDisconnected(peerId));
    }

    public init(id: string): void {
        const runtime = this.context.runtime;

        console.log('[PlayerPresenceService] Initializing Local Player with ID:', id);

        let spawnIndex = 0;
        if (!this.context.isHost) {
            if (runtime.session && (runtime.session as any).assignedSpawnIndex !== undefined) {
                spawnIndex = (runtime.session as any).assignedSpawnIndex;
            } else if (runtime.network) {
                spawnIndex = runtime.network.connections.size;
            }
        }

        const spawn = (runtime.session as any).getSpawnPoint ? (runtime.session as any).getSpawnPoint(spawnIndex) : { position: { x: 0, y: 0, z: 0 }, yaw: 0 };

        this.context.localPlayer = EntityFactory.createPlayer(this.context, id, {
            isLocal: true,
            spawnPos: spawn.position || { x: 0, y: 0, z: 0 },
            spawnYaw: spawn.yaw || 0,
            color: this.context.avatarConfig.color || 0x00ffff
        }) as any;

        if (this.context.localPlayer) {
            (this.context.localPlayer as any).name = this.context.playerName || 'Player';
        }

        runtime.animation.setLocalPlayer(this.context.localPlayer as any, runtime);
        runtime.entity.addEntity(this.context.localPlayer as any);
        this.isInitialized = true;
    }

    public onPeerDisconnected(peerId: string): void {
        const runtime = this.context.runtime;
        const entity = runtime.entity.getEntity(peerId);

        if (!entity) {
            console.warn(`[PlayerPresenceService] Received disconnect for unknown peer: ${peerId}`);
            return;
        }

        console.log(`[PlayerPresenceService] Removing entity for disconnected peer: ${peerId} (type: ${entity.type})`);

        const name = (entity as any).name;
        const isPlayer = entity.type === 'REMOTE_PLAYER' || entity.type === 'LOCAL_PLAYER';

        // Critical: Always trigger destruction and removal
        runtime.entity.removeEntity(peerId);

        if (isPlayer && runtime.hud) {
            runtime.hud.showNotification(`${name || 'A player'} left the hangout.`);
        }
    }
}
