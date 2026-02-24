import { LocalPlayer } from '../entities/LocalPlayer';

export abstract class Skill {
    public id: string;
    public name: string;
    public alwaysActive: boolean;
    public isActive: boolean = false;

    constructor(id: string, name: string, { alwaysActive = false }: { alwaysActive?: boolean } = {}) {
        this.id = id;
        this.name = name;
        this.alwaysActive = alwaysActive;
    }

    public activate(player: LocalPlayer): void {
        this.isActive = true;
    }

    public deactivate(player: LocalPlayer): void {
        this.isActive = false;
    }

    public abstract update(delta: number, player: LocalPlayer): void;

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
