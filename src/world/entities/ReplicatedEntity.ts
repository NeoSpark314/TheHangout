import { IEntity } from '../../shared/contracts/IEntity';
import { INetworkable } from '../../shared/contracts/INetworkable';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { IEntityState } from '../../shared/contracts/IEntityState';

export abstract class ReplicatedEntity implements IEntity, INetworkable<any> {
    public id: string;
    public type: string;
    public isAuthority: boolean;
    public isDestroyed: boolean = false;
    public ownerId: string | null = null;

    constructor(protected context: AppContext, id: string, type: string, isAuthority: boolean = false) {
        this.id = id;
        this.type = type;
        this.isAuthority = isAuthority;
    }

    /**
     * Standardized way to claim control over an entity.
     */
    public requestOwnership(): boolean {
        const localId = this.context.localPlayer?.id || 'local';
        if (this.ownerId === localId) return true;

        if (this.context.isHost) {
            this.ownerId = localId;
            this.isAuthority = true;
            return true;
        }

        // On guests, avoid creating split-brain authority when another peer
        // already owns the entity. Wait for host transfer ACK first.
        if (this.ownerId && this.ownerId !== localId) {
            eventBus.emit(EVENTS.REQUEST_OWNERSHIP, { entityId: this.id });
            return false;
        }

        // Optimistic claim is only safe for currently-unowned entities.
        this.ownerId = localId;
        this.isAuthority = true;

        eventBus.emit(EVENTS.REQUEST_OWNERSHIP, { entityId: this.id });
        return true;
    }

    /**
     * Helper for subclasses to sync common network properties.
     */
    protected syncNetworkState(state: any): void {
        const localId = this.context.localPlayer?.id || 'local';

        const incomingOwnerId = state.ownerId;

        if (incomingOwnerId !== undefined && incomingOwnerId !== this.ownerId) {
            if (this.isAuthority && incomingOwnerId === null) return;

            this.ownerId = incomingOwnerId;
            this.isAuthority = (this.ownerId === localId) || (this.ownerId === null && this.context.isHost);
        }
    }

    abstract update(delta: number): void;
    abstract getNetworkState(fullSync?: boolean): Partial<IEntityState> | null;
    abstract applyNetworkState(state: Partial<IEntityState>): void;

    /**
     * Called when a specialized network event occurs for this entity.
     * Overridden by subclasses to handle things like ownership release data.
     */
    public onNetworkEvent(type: string, payload: any): void {
        // Optional override
    }

    onAuthorityChanged(isAuthority: boolean): void {
        this.isAuthority = isAuthority;
    }

    destroy(): void {
        this.isDestroyed = true;
    }
}
