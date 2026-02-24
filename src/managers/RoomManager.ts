import * as THREE from 'three';
import gameState, { RoomConfig } from '../core/GameState';
import { EnvironmentManager } from './EnvironmentManager';
import { PropManager } from './PropManager';

export class RoomManager {
    public scene: THREE.Scene | null = null;
    private _seed: number = 0;
    public environment: EnvironmentManager | null = null;
    public props: PropManager | null = null;
    private groundPhysics: boolean = false;
    public assignedSpawnIndex?: number;

    constructor() {}

    private random(): number {
        this._seed |= 0;
        this._seed = (this._seed + 0x6D2B79F5) | 0;
        let t = Math.imul(this._seed ^ (this._seed >>> 15), 1 | this._seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    public init(scene: THREE.Scene): void {
        this.scene = scene;
        const randomBound = this.random.bind(this);
        this.environment = new EnvironmentManager(scene, randomBound);
        this.props = new PropManager(scene, randomBound);
        this.applyConfig(gameState.roomConfig);
    }

    public applyConfig(config: RoomConfig): void {
        if (!this.scene || !config || !this.environment || !this.props) return;

        console.log('[RoomManager] Coordinating Room Config:', config);
        if (config.seed !== undefined) {
            this._seed = config.seed;
        }

        this.environment.applyConfig(config);
        this.props.applyConfig(config);

        if (gameState.managers.physics && !this.groundPhysics) {
            gameState.managers.physics.createGround(25);
            this.groundPhysics = true;
        }
    }

    public update(delta: number): void {
        if (this.environment) this.environment.update(delta);
        if (this.props) this.props.update(delta);
    }

    public updateConfig(newConfig: Partial<RoomConfig> & { assignedSpawnIndex?: number }): void {
        const oldSeed = gameState.roomConfig.seed;

        if (newConfig.assignedSpawnIndex !== undefined) {
            this.assignedSpawnIndex = newConfig.assignedSpawnIndex;
            delete newConfig.assignedSpawnIndex;
        }

        gameState.roomConfig = { ...gameState.roomConfig, ...newConfig as RoomConfig };

        if (newConfig.seed !== undefined && newConfig.seed !== oldSeed) {
            this.clearProceduralElements();
        }

        this.applyConfig(gameState.roomConfig);
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
}
