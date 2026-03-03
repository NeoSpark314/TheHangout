import type { AppContext } from '../../app/AppContext';
import type { IEntity } from '../../shared/contracts/IEntity';
import type { IObjectModule, IObjectSpawnConfig } from '../contracts/IObjectModule';

export class ObjectModuleRegistry {
    private readonly modules = new Map<string, IObjectModule>();

    public replaceAll(nextModules: IObjectModule[]): void {
        this.modules.clear();
        for (const module of nextModules) {
            this.modules.set(module.id, module);
        }
    }

    public register(module: IObjectModule): void {
        this.modules.set(module.id, module);
    }

    public get(id: string): IObjectModule | undefined {
        return this.modules.get(id);
    }

    public list(): IObjectModule[] {
        return Array.from(this.modules.values());
    }

    public listIds(): string[] {
        return Array.from(this.modules.keys());
    }

    public spawn(id: string, context: AppContext, config: IObjectSpawnConfig): IEntity | null {
        const module = this.modules.get(id);
        if (!module) return null;
        return module.spawn(context, config);
    }
}
