import type { IScenarioModule } from '../contracts/IScenarioModule';

export class ScenarioRegistry {
    private readonly scenarios = new Map<string, IScenarioModule>();

    public register(scenario: IScenarioModule): void {
        this.scenarios.set(scenario.id, scenario);
    }

    public get(id: string): IScenarioModule | undefined {
        return this.scenarios.get(id);
    }

    public has(id: string): boolean {
        return this.scenarios.has(id);
    }

    public list(): IScenarioModule[] {
        return Array.from(this.scenarios.values());
    }

    public listIds(): string[] {
        return Array.from(this.scenarios.keys());
    }
}
