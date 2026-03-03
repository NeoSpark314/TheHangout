import type { AppContext } from '../../../app/AppContext';
import { DebugBeaconObject } from '../../objects/DebugBeaconObject';
import { DrawingSurfaceObject } from '../../objects/DrawingSurfaceObject';
import { PenToolObject } from '../../objects/PenToolObject';
import type { IObjectModule } from '../../contracts/IObjectModule';
import type { IDesktopScreenLayout } from '../../../shared/contracts/IDesktopScreenLayout';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { SessionRuntime } from '../../../world/session/SessionRuntime';
import { DefaultHangoutWorld } from './DefaultHangoutWorld';

export class DefaultHangoutScenario implements IScenarioModule {
    public readonly id = 'default-hangout';
    public readonly displayName = 'Default Hangout';
    public readonly kind = 'social' as const;
    public readonly maxPlayers = 16;
    private readonly objectModules: IObjectModule[] = [new DrawingSurfaceObject(), new PenToolObject(), new DebugBeaconObject()];
    private readonly world: DefaultHangoutWorld;

    constructor(session: SessionRuntime, context: AppContext) {
        this.world = new DefaultHangoutWorld(session, context);
    }

    public load(context: AppContext, options: IScenarioLoadOptions): void {
        const seed = options.seed ?? context.sessionConfig.seed;
        if (context.sessionConfig.seed !== seed) {
            context.sessionConfig = { ...context.sessionConfig, seed };
        }
        this.world.load(context.sessionConfig);
        this.world.setHologramVisible(true);
    }

    public unload(_context: AppContext): void {
        this.world.unload();
    }

    public update(delta: number): void {
        this.world.update(delta);
    }

    public getSpawnPoint(index: number): IScenarioSpawnPoint {
        const radius = 2.5;
        const angle = (index * (Math.PI / 4)) + Math.PI;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;

        return {
            position: { x, y: 0.2, z },
            yaw: angle
        };
    }

    public getObjectModules(): IObjectModule[] {
        return this.objectModules;
    }

    public applyConfig(_context: AppContext, config: AppContext['sessionConfig']): void {
        this.world.applyConfig(config);
    }

    public getDesktopLayout(index: number, total: number): IDesktopScreenLayout {
        return this.world.getDesktopLayout(index, total);
    }

    public setHologramVisible(visible: boolean): void {
        this.world.setHologramVisible(visible);
    }
}
