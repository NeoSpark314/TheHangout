import type { AppContext, ISessionConfig } from '../../../app/AppContext';
import type { IDesktopScreenLayout } from '../../../shared/contracts/IDesktopScreenLayout';
import { EnvironmentBuilder } from '../../../assets/procedural/EnvironmentBuilder';
import { PropBuilder } from '../../../assets/procedural/PropBuilder';
import type { SessionRuntime } from '../../../world/session/SessionRuntime';

export class DefaultHangoutWorld {
    private environment: EnvironmentBuilder | null = null;
    private props: PropBuilder | null = null;

    constructor(
        private session: SessionRuntime,
        private context: AppContext
    ) { }

    public load(config: ISessionConfig): void {
        const scene = this.session.scene;
        if (!scene) return;

        this.session.ensureGroundPhysics();

        if (!this.environment) {
            this.environment = new EnvironmentBuilder(scene, () => this.session.randomFloat());
        }

        if (!this.props) {
            this.props = new PropBuilder(scene, () => this.session.randomFloat(), this.context);
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
}
