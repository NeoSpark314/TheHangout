import { PlayerAvatarEntity } from '../world/entities/PlayerAvatarEntity';
import type { IRuntimeRegistry } from '../app/AppContext';

export abstract class Skill {
    public id: string;
    public name: string;
    public isAlwaysActive: boolean;
    public isActive: boolean = false;

    constructor(id: string, name: string, { isAlwaysActive = false }: { isAlwaysActive?: boolean } = {}) {
        this.id = id;
        this.name = name;
        this.isAlwaysActive = isAlwaysActive;
    }

    public activate(player: PlayerAvatarEntity): void {
        this.isActive = true;
    }

    public deactivate(player: PlayerAvatarEntity): void {
        this.isActive = false;
    }

    public abstract update(delta: number, player: PlayerAvatarEntity, runtime: IRuntimeRegistry): void;

    public getNetworkState(): any {
        return null;
    }

    public setNetworkState(state: any): void {
        // Optional
    }

    public destroy(): void {
        // Optional
    }
}
