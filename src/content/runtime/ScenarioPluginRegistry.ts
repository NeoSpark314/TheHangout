import type { IScenarioPlugin } from '../contracts/IScenarioPlugin';

export class ScenarioPluginRegistry {
    private readonly plugins = new Map<string, IScenarioPlugin>();

    public register(plugin: IScenarioPlugin): void {
        this.plugins.set(plugin.id, plugin);
    }

    public get(id: string): IScenarioPlugin | undefined {
        return this.plugins.get(id);
    }

    public has(id: string): boolean {
        return this.plugins.has(id);
    }

    public list(): IScenarioPlugin[] {
        return Array.from(this.plugins.values());
    }

    public listIds(): string[] {
        return Array.from(this.plugins.keys());
    }
}
