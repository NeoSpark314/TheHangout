import type { IScenarioConfig } from '../../../app/AppContext';
import type { IDesktopScreenLayout } from '../../../shared/contracts/IDesktopScreenLayout';
import { EnvironmentBuilder } from '../../../assets/procedural/EnvironmentBuilder';
import { PropBuilder } from '../../../assets/procedural/PropBuilder';
import type { IScenarioContext } from '../../contracts/IScenarioContext';

export class DefaultHangoutWorld {
    private environment: EnvironmentBuilder | null = null;
    private props: PropBuilder | null = null;
    private lastConfig: IScenarioConfig = {};
    private readonly drawingSurfaceId = 'default-drawing-surface';
    private readonly defaultPenId = 'default-pen';
    private readonly defaultGunId = 'default-pew-pew-gun';
    private readonly drumPadArcId = 'default-drum-pad-arc';
    private readonly defaultChairId = 'default-chair';
    private readonly defaultCubeColors = [0xff0055, 0x00ff88, 0x5500ff, 0xff8800, 0x00ccff, 0xffff00];

    public loadWorld(context: IScenarioContext): void {
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
                position: { x: 1.0, y: 1.12, z: -0.82 },
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
        if (!this.props) {
            this.props = new PropBuilder(null, () => context.random.float(), {
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

    public loadVisuals(context: IScenarioContext): void {
        const scene = context.scene.getRoot();
        if (scene && !this.environment) {
            this.environment = new EnvironmentBuilder(scene, () => context.random.float());
        }

        this.props?.setScene(scene);
        this.applyConfig(context, this.lastConfig);
    }

    public applyConfig(context: IScenarioContext, config: IScenarioConfig): void {
        this.lastConfig = config || {};
        if (!this.props) {
            this.loadWorld(context);
        }
        if (context.scene.getRoot() && !this.environment) {
            this.loadVisuals(context);
        }

        if (!this.props) {
            return;
        }

        this.environment?.applyConfig(this.lastConfig);
        this.props.applyConfig(this.lastConfig);
    }

    public update(delta: number): void {
        this.environment?.update(delta);
        this.props?.update(delta);
    }

    public unloadVisuals(): void {
        this.environment?.clearProcedural();
        this.environment = null;

        this.props?.dispose();
        this.props = null;
    }

    public unloadWorld(): void { }

    public getFeatureLayout(featureId: string, index: number, total: number): IDesktopScreenLayout | null {
        if (featureId === 'remote-desktop' && this.props) {
            return this.props.getFeatureLayout(featureId, index, total);
        }

        return null;
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


