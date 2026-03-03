import type { AppContext } from '../../../app/AppContext';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { SessionRuntime } from '../../../world/session/SessionRuntime';

export class WideCircleScenario implements IScenarioModule {
    public readonly id = 'wide-circle';
    public readonly displayName = 'Wide Circle';
    public readonly kind = 'social' as const;
    public readonly maxPlayers = 16;

    constructor(private session: SessionRuntime) { }

    public load(context: AppContext, options: IScenarioLoadOptions): void {
        this.session.ensureDefaultWorld(this.session.scene);
        const seed = options.seed ?? context.sessionConfig.seed;
        if (context.sessionConfig.seed !== seed) {
            context.sessionConfig = { ...context.sessionConfig, seed };
        }
        this.session.applyConfig(context.sessionConfig);
        this.session.toggleHologram(false);
    }

    public unload(_context: AppContext): void {
        this.session.clearProceduralElements();
    }

    public update(delta: number): void {
        if (this.session.environment) this.session.environment.update(delta);
        if (this.session.props) this.session.props.update(delta);
    }

    public getSpawnPoint(index: number): IScenarioSpawnPoint {
        const radius = 4.2;
        const angle = (index * (Math.PI / 8)) + Math.PI;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;

        return {
            position: { x, y: 0.2, z },
            yaw: angle
        };
    }
}
