import type { ISessionConfig } from '../../../app/AppContext';
import type { IDesktopScreenLayout } from '../../../shared/contracts/IDesktopScreenLayout';
import { EnvironmentBuilder } from '../../../assets/procedural/EnvironmentBuilder';
import { PropBuilder } from '../../../assets/procedural/PropBuilder';
import type { IScenarioContext } from '../../contracts/IScenarioContext';

export class DefaultHangoutWorld {
    private environment: EnvironmentBuilder | null = null;
    private props: PropBuilder | null = null;
    private readonly drawingSurfaceId = 'default-drawing-surface';
    private readonly defaultPenId = 'default-pen';
    private readonly defaultGunId = 'default-pew-pew-gun';
    private readonly drumPadArcId = 'default-drum-pad-arc';
    private readonly defaultChairId = 'default-chair';
    private readonly defaultCubeColors = [0xff0055, 0x00ff88, 0x5500ff, 0xff8800, 0x00ccff, 0xffff00];

    public load(context: IScenarioContext): void {
        if (!context.objects.get(this.drawingSurfaceId)) {
            context.objects.spawn('drawing-surface', { id: this.drawingSurfaceId });
        }
        if (!context.objects.get(this.defaultPenId)) {
            context.objects.spawn('pen-tool', {
                id: this.defaultPenId,
                position: { x: 0.5, y: 1.15, z: 0.5 }
            });
        }
        if (!context.objects.get(this.defaultGunId)) {
            context.objects.spawn('pew-pew-gun', {
                id: this.defaultGunId,
                position: { x: 0.0, y: 1.12, z: -0.82 },
                rotationY: 0
            });
        }
        if (!context.objects.get(this.drumPadArcId)) {
            context.objects.spawn('drum-pad-arc', { id: this.drumPadArcId });
        }
        if (!context.objects.get(this.defaultChairId)) {
            context.objects.spawn('chair', {
                id: this.defaultChairId,
                position: { x: -2.4, y: 0, z: 0.8 },
                rotationY: Math.PI / 2
            });
        }
        this.ensureDefaultCubes(context);

        context.physics.ensureGround();
        const scene = context.scene.getRoot();
        if (!scene) return;

        if (!this.environment) {
            this.environment = new EnvironmentBuilder(scene, () => context.random.float());
        }

        if (!this.props) {
            this.props = new PropBuilder(scene, () => context.random.float(), {
                assets: {
                    getNormalizedModel: (url, targetSize) => context.assets.getNormalizedModel(url, targetSize)
                },
                physics: {
                    createStaticBox: (options) => context.physics.createStaticBox(options),
                    removeBody: (body) => context.physics.removeBody(body)
                },
                entities: {
                    removeEntity: () => { }
                }
            });
        }

    }

    public applyConfig(context: IScenarioContext, config: ISessionConfig): void {
        if (!this.props || !this.environment) {
            this.load(context);
        }

        if (!this.props || !this.environment) {
            return;
        }

        this.environment.applyConfig(config);
        this.props.applyConfig(config);
    }

    public update(delta: number): void {
        this.environment?.update(delta);
        this.props?.update(delta);
    }

    public unload(): void {
        this.environment?.clearProcedural();
        this.environment = null;

        this.props?.dispose();
        this.props = null;
    }

    public getDesktopLayout(index: number, total: number): IDesktopScreenLayout {
        if (this.props) {
            return this.props.getDesktopLayout(index, total);
        }

        return {
            position: [0, 1.5 + index * 0.1, -2.4],
            billboard: true
        };
    }

    public setHologramVisible(visible: boolean): void {
        this.props?.setHologramVisible(visible);
    }

    private ensureDefaultCubes(context: IScenarioContext): void {
        for (let i = 0; i < this.defaultCubeColors.length; i++) {
            const cubeId = `default-cube-${i}`;
            if (context.objects.get(cubeId)) {
                continue;
            }

            const angle = (i / this.defaultCubeColors.length) * Math.PI * 2;
            context.objects.spawn('grabbable-cube', {
                id: cubeId,
                position: { x: Math.sin(angle), y: 1.15, z: Math.cos(angle) },
                color: this.defaultCubeColors[i],
                size: 0.12
            });
        }
    }
}
