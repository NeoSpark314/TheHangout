import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../contracts/IScenarioPlugin';
import type { IScenarioContext } from '../../contracts/IScenarioContext';
import { WideCircleVisuals } from './WideCircleVisuals';

export class WideCircleScenario implements IScenarioModule {
    public readonly id = 'wide-circle';
    public readonly displayName = 'Wide Circle';
    public readonly kind = 'social' as const;
    public readonly maxPlayers = 16;

    private visuals: WideCircleVisuals | null = null;
    private visualSeed = 1;

    public loadWorld(context: IScenarioContext, options: IScenarioLoadOptions): void {
        context.physics.ensureGround();
        this.visualSeed = options.seed ?? 1;
    }

    public loadVisuals(context: IScenarioContext, _options: IScenarioLoadOptions): void {
        if (this.visuals) {
            this.visuals.destroy();
            this.visuals = null;
        }
        const scene = context.scene.getRoot();
        if (scene) {
            this.visuals = new WideCircleVisuals(scene, this.visualSeed);
        }
    }

    public unloadVisuals(_context: IScenarioContext): void {
        if (this.visuals) {
            this.visuals.destroy();
            this.visuals = null;
        }
    }

    public unloadWorld(_context: IScenarioContext): void { }

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
    create() {
        return new WideCircleScenario();
    }
};
