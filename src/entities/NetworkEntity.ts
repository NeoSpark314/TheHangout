import { IEntity } from '../interfaces/IEntity';
import { INetworkable } from '../interfaces/INetworkable';

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
