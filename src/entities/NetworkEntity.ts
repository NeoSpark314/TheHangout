import { IEntity } from '../interfaces/IEntity';
import { INetworkable } from '../interfaces/INetworkable';
import { GameContext } from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

export abstract class NetworkEntity implements IEntity, INetworkable<any> {
    public id: string;
    public type: string;
    public isAuthority: boolean;
    public destroyed: boolean = false;
    public ownerId: string | null = null;

    constructor(protected context: GameContext, id: string, type: string, isAuthority: boolean = false) {
        this.id = id;
        this.type = type;
        this.isAuthority = isAuthority;
    }

    /**
     * Standardized way to claim control over an entity.
     */
    public requestOwnership(): void {
        const localId = this.context.localPlayer?.id || 'local';
        if (this.ownerId === localId) return;

        this.ownerId = localId;
        this.isAuthority = true;

        if (!this.context.isHost) {
            eventBus.emit(EVENTS.REQUEST_OWNERSHIP, { id: this.id });
        }
    }

    /**
     * Standardized way to release control.
     */
    public releaseOwnership(): void {
        if (!this.isAuthority) return;
        this.ownerId = null;
        // Authority usually reverts to Host or stays true until reclaimed
    }

    /**
     * Helper for subclasses to sync common network properties.
     */
    protected syncNetworkState(state: any): void {
        const localId = this.context.localPlayer?.id || 'local';

        // Support both full and abbreviated keys
        const incomingOwnerId = state.ownerId !== undefined ? state.ownerId : state.o;

        if (incomingOwnerId !== undefined && incomingOwnerId !== this.ownerId) {
            if (this.isAuthority && incomingOwnerId === null) return;

            this.ownerId = incomingOwnerId;
            this.isAuthority = (this.ownerId === localId) || (this.ownerId === null && this.context.isHost);
        }
    }

    abstract update(delta: number): void;
    abstract getNetworkState(): any;
    abstract applyNetworkState(state: any): void;

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
        this.destroyed = true;
    }
}
