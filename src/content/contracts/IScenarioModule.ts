import type { AppContext } from '../../app/AppContext';
import type { ISessionConfig } from '../../app/AppContext';
import type { IUpdatable } from '../../shared/contracts/IUpdatable';
import type { IDesktopScreenLayout } from '../../shared/contracts/IDesktopScreenLayout';
import type { IObjectModule } from './IObjectModule';
import type { IScenarioActionProvider } from './IScenarioAction';

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
    load(context: AppContext, options: IScenarioLoadOptions): void;
    unload(context: AppContext): void;
    getSpawnPoint(index: number): IScenarioSpawnPoint;

    applyConfig?(context: AppContext, config: ISessionConfig): void;
    getDesktopLayout?(index: number, total: number): IDesktopScreenLayout;
    setHologramVisible?(visible: boolean): void;
    getObjectModules?(): IObjectModule[];
    getActionProvider?(): IScenarioActionProvider;
    onPlayerJoined?(playerId: string): void;
    onPlayerLeft?(playerId: string): void;
}
