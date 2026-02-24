import { IEntity } from '../interfaces/IEntity';
import { INetworkable } from '../interfaces/INetworkable';
import gameState from '../core/GameState';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';

export abstract class NetworkEntity implements IEntity, INetworkable<any> {
    public id: string;
    public type: string;
    public isAuthority: boolean;
    public destroyed: boolean = false;
    public ownerId: string | null = null;

    constructor(id: string, type: string, isAuthority: boolean = false) {
        this.id = id;
        this.type = type;
        this.isAuthority = isAuthority;
    }

    /**
     * Standardized way to claim control over an entity.
     */
    public requestOwnership(): void {
        const localId = gameState.localPlayer?.id || 'local';
        if (this.ownerId === localId) return;

        this.ownerId = localId;
        this.isAuthority = true;

        if (!gameState.isHost) {
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
        const localId = gameState.localPlayer?.id || 'local';
        
        // Support both full and abbreviated keys
        const incomingOwnerId = state.ownerId !== undefined ? state.ownerId : state.o;

        if (incomingOwnerId !== undefined && incomingOwnerId !== this.ownerId) {
            if (this.isAuthority && incomingOwnerId === null) return;

            this.ownerId = incomingOwnerId;
            this.isAuthority = (this.ownerId === localId) || (this.ownerId === null && gameState.isHost);
        }
    }

    abstract update(delta: number): void;
    abstract getNetworkState(): any;
    abstract applyNetworkState(state: any): void;

    onAuthorityChanged(isAuthority: boolean): void {
        this.isAuthority = isAuthority;
    }

    destroy(): void {
        this.destroyed = true;
    }
}
