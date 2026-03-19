import type { AppContext } from '../../app/AppContext';
import type { SessionRuntime } from '../../world/session/SessionRuntime';
import type { IScenarioModule } from './IScenarioModule';

export interface IScenarioPluginCapabilities {
    headless?: boolean;
    usesPhysics?: boolean;
    usesAudio?: boolean;
    hasActions?: boolean;
    hasPortableObjects?: boolean;
}

export interface IScenarioPluginCreateContext {
    app: AppContext;
    session: SessionRuntime;
}

export interface IScenarioPlugin {
    id: string;
    displayName: string;
    version?: string;
    kind?: 'social' | 'minigame' | 'exploration' | 'puzzle';
    maxPlayers?: number;
    capabilities?: IScenarioPluginCapabilities;
    create(context: IScenarioPluginCreateContext): IScenarioModule;
}
