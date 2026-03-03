import type { AppContext } from '../../app/AppContext';
import type { IUpdatable } from '../../shared/contracts/IUpdatable';
import type { IObjectModule } from './IObjectModule';

export interface IScenarioLoadOptions {
    isHost: boolean;
    seed?: number;
    reason?: 'session_start' | 'scenario_switch' | 'reload';
}

export interface IScenarioSpawnPoint {
    position: { x: number; y: number; z: number };
    yaw: number;
}

export interface IScenarioModule extends IUpdatable {
    id: string;
    displayName: string;
    kind?: 'social' | 'minigame' | 'exploration' | 'puzzle';
    maxPlayers?: number;

    load(context: AppContext, options: IScenarioLoadOptions): Promise<void> | void;
    unload(context: AppContext): Promise<void> | void;
    getSpawnPoint(index: number): IScenarioSpawnPoint;

    getObjectModules?(): IObjectModule[];
    onPlayerJoined?(playerId: string): void;
    onPlayerLeft?(playerId: string): void;
}
