import type { AppContext } from '../../app/AppContext';
import type { INetworkable } from '../../shared/contracts/INetworkable';
import { EntityType, type IStateUpdatePacket } from '../../shared/contracts/IEntityState';

interface IApplyEntityStateUpdatesOptions {
    source: 'state_update' | 'player_input';
    authorityMode: 'host' | 'guest';
    senderId?: string;
    skipLocalPlayerSelfDiscover?: boolean;
}

export function applyEntityStateUpdates(
    context: AppContext,
    entityStates: IStateUpdatePacket[],
    options: IApplyEntityStateUpdatesOptions
): void {
    const runtime = context.runtime;
    const localId = context.localPlayer?.id || 'local';

    for (const stateData of entityStates) {
        let entity = runtime.entity.getEntity(stateData.id);
        if (!entity) {
            if (options.skipLocalPlayerSelfDiscover && context.localPlayer && stateData.id === context.localPlayer.id) {
                continue;
            }

            const config = {
                ...stateData.state,
                spawnPos: { x: 0, y: 0, z: 0 },
                spawnYaw: 0,
                isAuthority: false,
                controlMode: stateData.type === EntityType.PLAYER_AVATAR ? 'remote' : undefined
            };
            entity = runtime.entity.discover(stateData.id, stateData.type, config) || undefined;
        }
        if (!entity) continue;

        const state = stateData.state as { ownerId?: string | null; b?: string | null };
        const incomingOwnerId = state.ownerId;
        const incomingHeldBy = state.b ?? undefined;

        if (options.source === 'player_input' && stateData.type !== EntityType.PLAYER_AVATAR) {
            const currentOwnerId = (entity as { ownerId?: string | null }).ownerId ?? null;

            if (options.authorityMode === 'host') {
                const senderMatchesCurrentOwner = !!options.senderId && currentOwnerId === options.senderId;
                const incomingMatchesCurrentOwner = incomingOwnerId !== undefined && currentOwnerId === incomingOwnerId;
                if (currentOwnerId && !senderMatchesCurrentOwner && !incomingMatchesCurrentOwner) {
                    continue;
                }

                const senderMatchesIncomingOwner =
                    options.senderId !== undefined &&
                    incomingOwnerId !== undefined &&
                    incomingOwnerId === options.senderId;
                const canAdoptOptimisticUnownedClaim =
                    currentOwnerId === null &&
                    senderMatchesIncomingOwner &&
                    stateData.type === EntityType.PHYSICS_PROP;

                if (
                    canAdoptOptimisticUnownedClaim ||
                    (
                        currentOwnerId === null &&
                        incomingOwnerId !== undefined &&
                        incomingHeldBy !== undefined &&
                        (
                            (options.senderId !== undefined && incomingHeldBy === options.senderId) ||
                            incomingHeldBy === incomingOwnerId
                        )
                    )
                ) {
                    (entity as { ownerId?: string | null }).ownerId = incomingOwnerId;
                    entity.isAuthority = false;
                }
            } else if (incomingOwnerId !== undefined) {
                (entity as { ownerId?: string | null }).ownerId = incomingOwnerId;
                entity.isAuthority = (incomingOwnerId === localId) || (incomingOwnerId === null && context.isHost);
            }
        }

        if (!entity.isAuthority) {
            const networkable = entity as unknown as INetworkable<unknown>;
            networkable.applyNetworkState?.(stateData.state);
        }
    }
}
