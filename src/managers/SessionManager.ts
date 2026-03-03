import * as THREE from 'three';
import { GameContext, ISessionConfig } from '../core/GameState';
import { IUpdatable } from '../interfaces/IUpdatable';
import { EnvironmentManager } from './EnvironmentManager';
import { PropManager } from './PropManager';
import eventBus from '../core/EventBus';
import { EVENTS } from '../utils/Constants';
import { IDesktopScreenLayout } from '../interfaces/IDesktopScreenLayout';

export class SessionManager implements IUpdatable {
    public scene: THREE.Scene | null = null;
    private _seed: number = 0;
    public environment: EnvironmentManager | null = null;
    public props: PropManager | null = null;
    private hasGroundPhysics: boolean = false;
    public assignedSpawnIndex?: number;

    constructor(private context: GameContext) { }

    private random(): number {
        this._seed |= 0;
        this._seed = (this._seed + 0x6D2B79F5) | 0;
        let t = Math.imul(this._seed ^ (this._seed >>> 15), 1 | this._seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    public init(scene: THREE.Scene): void {
        try {
            this.scene = scene;
            const randomBound = this.random.bind(this);
            this.environment = new EnvironmentManager(scene, randomBound);
            this.props = new PropManager(scene, randomBound, this.context);

            // Ground is created strictly during applyConfig or init via master orchestrator
            if (this.context.managers.physics) {
                this.context.managers.physics.createGround(25);
                this.hasGroundPhysics = true;
            }

            this.applyConfig(this.context.sessionConfig);
        } catch (e) {
            console.error('[SessionManager] init crashed:', e);
        }
    }

    public applyConfig(config: ISessionConfig): void {
        if (!config || !this.environment || !this.props) return;

        console.log('[SessionManager] Coordinating Session Config:', config);
        if (config.seed !== undefined) {
            this._seed = config.seed;
        }

        this.environment.applyConfig(config);
        this.props.applyConfig(config);
    }

    public update(delta: number): void {
        if (this.environment) this.environment.update(delta);
        if (this.props) this.props.update(delta);
    }

    public updateConfig(newConfig: Partial<ISessionConfig> & { assignedSpawnIndex?: number }): void {
        const oldSeed = this.context.sessionConfig.seed;

        if (newConfig.assignedSpawnIndex !== undefined) {
            this.assignedSpawnIndex = newConfig.assignedSpawnIndex;
            delete newConfig.assignedSpawnIndex;
        }

        this.context.sessionConfig = { ...this.context.sessionConfig, ...newConfig as ISessionConfig };

        if (newConfig.seed !== undefined && newConfig.seed !== oldSeed) {
            this.clearProceduralElements();
        }

        this.applyConfig(this.context.sessionConfig);
    }

    public clearProceduralElements(): void {
        if (this.environment) this.environment.clearProcedural();
        if (this.props) this.props.clearProcedural();
    }

    public getSpawnPoint(index: number): { position: THREE.Vector3, yaw: number } {
        const radius = 2.5;
        const angle = (index * (Math.PI / 4)) + Math.PI;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;
        const yaw = angle;

        return {
            position: new THREE.Vector3(x, 0.2, z),
            yaw: yaw
        };
    }

    public getDesktopLayout(index: number, total: number): IDesktopScreenLayout {
        if (this.props) {
            return this.props.getDesktopLayout(index, total);
        }
        // Fallback
        return {
            position: [0, 1.5 + index * 0.1, -2.4],
            billboard: true
        };
    }

    public toggleHologram(visible: boolean): void {
        if (this.props) {
            this.props.setHologramVisible(visible);
        }
    }
}
