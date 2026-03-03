import { LocalPlayer } from '../world/entities/LocalPlayer';
import type { IManagers } from '../app/AppContext';

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

    public activate(player: LocalPlayer): void {
        this.isActive = true;
    }

    public deactivate(player: LocalPlayer): void {
        this.isActive = false;
    }

    public abstract update(delta: number, player: LocalPlayer, managers: IManagers): void;

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
