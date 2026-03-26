import type { IObjectModule } from './IObjectModule';
import type { IScenarioModule } from './IScenarioModule';

export interface IScenarioPluginCapabilities {
    headless?: boolean;
    usesPhysics?: boolean;
    usesAudio?: boolean;
    hasActions?: boolean;
    hasPortableObjects?: boolean;
}

export interface IScenarioPlugin {
    id: string;
    displayName: string;
    version?: string;
    kind?: 'social' | 'minigame' | 'exploration' | 'puzzle';
    maxPlayers?: number;
    capabilities?: IScenarioPluginCapabilities;
    objectModules?: ReadonlyArray<IObjectModule>;
    create(): IScenarioModule | Promise<IScenarioModule>;
}
