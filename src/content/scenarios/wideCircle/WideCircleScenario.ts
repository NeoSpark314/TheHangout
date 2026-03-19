import type { AppContext } from '../../../app/AppContext';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import type { SessionRuntime } from '../../../world/session/SessionRuntime';
import { WideCircleVisuals } from './WideCircleVisuals';

export class WideCircleScenario implements IScenarioModule {
    public readonly id = 'wide-circle';
    public readonly displayName = 'Wide Circle';
    public readonly kind = 'social' as const;
    public readonly maxPlayers = 16;

    constructor(private session: SessionRuntime) { }
    private visuals: WideCircleVisuals | null = null;

    public load(context: AppContext, options: IScenarioLoadOptions): void {
        this.session.ensureGroundPhysics();
        const seed = options.seed ?? context.sessionConfig.seed;
        if (context.sessionConfig.seed !== seed) {
            context.sessionConfig = { ...context.sessionConfig, seed };
        }
        if (this.visuals) {
            this.visuals.destroy();
            this.visuals = null;
        }
        if (this.session.scene) {
            this.visuals = new WideCircleVisuals(this.session.scene, seed);
        }
    }

    public unload(_context: AppContext): void {
        if (this.visuals) {
            this.visuals.destroy();
            this.visuals = null;
        }
    }

    public update(delta: number): void {
        this.visuals?.update(delta);
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

export const WideCircleScenarioPlugin: IScenarioPlugin = {
    id: 'wide-circle',
    displayName: 'Wide Circle',
    kind: 'social',
    maxPlayers: 16,
    capabilities: {
        headless: true,
        usesPhysics: true,
        usesAudio: false,
        hasActions: false,
        hasPortableObjects: false
    },
    create({ session }) {
        return new WideCircleScenario(session);
    }
};
