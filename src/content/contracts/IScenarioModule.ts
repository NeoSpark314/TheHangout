import type { ISessionConfig } from '../../app/AppContext';
import type { IUpdatable } from '../../shared/contracts/IUpdatable';
import type { IDesktopScreenLayout } from '../../shared/contracts/IDesktopScreenLayout';
import type { IObjectModule } from './IObjectModule';
import type { IScenarioActionProvider } from './IScenarioAction';
import type { IScenarioContext } from './IScenarioContext';

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

    // Scenario transitions are intentionally synchronous and atomic for now.
    // If async loading is needed later, it should use a dedicated transition flow
    // with explicit locking/failure handling rather than implicit Promise returns.
    load(context: IScenarioContext, options: IScenarioLoadOptions): void;
    unload(context: IScenarioContext): void;
    getSpawnPoint(index: number): IScenarioSpawnPoint;

    applyConfig?(context: IScenarioContext, config: ISessionConfig): void;
    getDesktopLayout?(index: number, total: number): IDesktopScreenLayout;
    setHologramVisible?(visible: boolean): void;
    getObjectModules?(): IObjectModule[];
    getActionProvider?(): IScenarioActionProvider;
    onPlayerJoined?(context: IScenarioContext, playerId: string): void;
    onPlayerLeft?(context: IScenarioContext, playerId: string): void;
}
