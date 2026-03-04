import type { AppContext, ISessionConfig } from '../../../app/AppContext';
import type { IDesktopScreenLayout } from '../../../shared/contracts/IDesktopScreenLayout';
import { EnvironmentBuilder } from '../../../assets/procedural/EnvironmentBuilder';
import { PropBuilder } from '../../../assets/procedural/PropBuilder';
import type { SessionRuntime } from '../../../world/session/SessionRuntime';

export class DefaultHangoutWorld {
    private environment: EnvironmentBuilder | null = null;
    private props: PropBuilder | null = null;
    private readonly drawingSurfaceId = 'default-drawing-surface';
    private readonly defaultPenId = 'default-pen';
    private readonly drumPadArcId = 'default-drum-pad-arc';
    private readonly defaultChairId = 'default-chair';
    private readonly defaultCubeColors = [0xff0055, 0x00ff88, 0x5500ff, 0xff8800, 0x00ccff, 0xffff00];

    constructor(
        private session: SessionRuntime,
        private context: AppContext
    ) { }

    public load(config: ISessionConfig): void {
        if (!this.session.getObjectInstance(this.drawingSurfaceId)) {
            this.session.spawnObjectModule('drawing-surface', { id: this.drawingSurfaceId });
        }
        if (!this.session.getObjectInstance(this.defaultPenId)) {
            this.session.spawnObjectModule('pen-tool', {
                id: this.defaultPenId,
                position: { x: 0.5, y: 1.15, z: 0.5 }
            });
        }
        if (!this.session.getObjectInstance(this.drumPadArcId)) {
            this.session.spawnObjectModule('drum-pad-arc', { id: this.drumPadArcId });
        }
        if (!this.session.getObjectInstance(this.defaultChairId)) {
            this.session.spawnObjectModule('chair', {
                id: this.defaultChairId,
                position: { x: -2.4, y: 0, z: 0.8 },
                rotationY: Math.PI / 2
            });
        }
        this.ensureDefaultCubes();

        const scene = this.session.scene;

        // Ensure we load the ground physics for headless network sync
        this.session.ensureGroundPhysics();

        // Headless dedicated sessions still need gameplay objects and static physics,
        // but they do not own a Three.js scene and should skip visual-only builders.
        if (scene && !this.environment) {
            this.environment = new EnvironmentBuilder(scene as any, () => this.session.randomFloat());
        }

        if (!this.props) {
            this.props = new PropBuilder(scene as any, () => this.session.randomFloat(), this.context);
        }

        this.environment.applyConfig(config);
        this.props.applyConfig(config);
    }

    public applyConfig(config: ISessionConfig): void {
        if (!this.environment || !this.props) {
            this.load(config);
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

    private ensureDefaultCubes(): void {
        for (let i = 0; i < this.defaultCubeColors.length; i++) {
            const cubeId = `default-cube-${i}`;
            if (this.session.getObjectInstance(cubeId)) {
                continue;
            }

            const angle = (i / this.defaultCubeColors.length) * Math.PI * 2;
            this.session.spawnObjectModule('grabbable-cube', {
                id: cubeId,
                position: { x: Math.sin(angle), y: 1.15, z: Math.cos(angle) },
                color: this.defaultCubeColors[i],
                size: 0.12
            });
        }
    }
}
