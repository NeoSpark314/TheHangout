import * as THREE from 'three';
import { AppContext, ISessionConfig } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { IDesktopScreenLayout } from '../../shared/contracts/IDesktopScreenLayout';
import { DefaultHangoutScenario } from '../../content/scenarios/defaultHangout/DefaultHangoutScenario';
import type { IObjectSpawnConfig } from '../../content/contracts/IObjectModule';
import type { IScenarioLoadOptions, IScenarioModule } from '../../content/contracts/IScenarioModule';
import { ObjectModuleRegistry } from '../../content/runtime/ObjectModuleRegistry';
import { ScenarioRegistry } from '../../content/runtime/ScenarioRegistry';
import { WideCircleScenario } from '../../content/scenarios/wideCircle/WideCircleScenario';

export class SessionRuntime implements IUpdatable {
    public scene: THREE.Scene | null = null;
    private _seed: number = 0;
    private hasGroundPhysics: boolean = false;
    private readonly scenarioEntityIds = new Set<string>();
    private readonly objectModuleRegistry = new ObjectModuleRegistry();
    private readonly scenarioRegistry = new ScenarioRegistry();
    private activeScenario: IScenarioModule;
    public assignedSpawnIndex?: number;

    constructor(private context: AppContext) {
        const defaultScenario = new DefaultHangoutScenario(this, context);
        const wideCircleScenario = new WideCircleScenario(this);
        this.scenarioRegistry.register(defaultScenario);
        this.scenarioRegistry.register(wideCircleScenario);
        this.activeScenario = defaultScenario;
        this.refreshActiveObjectModules();
    }

    private random(): number {
        this._seed |= 0;
        this._seed = (this._seed + 0x6D2B79F5) | 0;
        let t = Math.imul(this._seed ^ (this._seed >>> 15), 1 | this._seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    public randomFloat(): number {
        return this.random();
    }

    public init(scene: THREE.Scene): void {
        try {
            this.scene = scene;
            this._seed = this.context.sessionConfig.seed;
            const configuredScenario = this.scenarioRegistry.get(this.context.sessionConfig.activeScenarioId);
            if (configuredScenario) {
                this.activeScenario = configuredScenario;
            }
            this.activeScenario.load(this.context, {
                isHost: this.context.isHost,
                seed: this.context.sessionConfig.seed,
                reason: 'session_start'
            });
            this.refreshActiveObjectModules();
        } catch (e) {
            console.error('[SessionRuntime] init crashed:', e);
        }
    }

    public ensureGroundPhysics(): void {
        if (!this.hasGroundPhysics && this.context.runtime.physics) {
            this.context.runtime.physics.createGround(25);
            this.hasGroundPhysics = true;
        }
    }

    public update(delta: number): void {
        this.activeScenario.update(delta);
    }

    public updateConfig(newConfig: Partial<ISessionConfig> & { assignedSpawnIndex?: number }): void {
        const oldSeed = this.context.sessionConfig.seed;
        const oldScenarioId = this.context.sessionConfig.activeScenarioId;

        if (newConfig.assignedSpawnIndex !== undefined) {
            this.assignedSpawnIndex = newConfig.assignedSpawnIndex;
            delete newConfig.assignedSpawnIndex;
        }

        this.context.sessionConfig = { ...this.context.sessionConfig, ...newConfig as ISessionConfig };
        const scenarioChanged = this.context.sessionConfig.activeScenarioId !== oldScenarioId;

        if (scenarioChanged) {
            this.switchScenario(this.context.sessionConfig.activeScenarioId, {
                seed: this.context.sessionConfig.seed,
                reason: 'scenario_switch'
            });
            return;
        }

        if (newConfig.seed !== undefined && newConfig.seed !== oldSeed) {
            this._seed = this.context.sessionConfig.seed;
            if (this.scene) {
                this.activeScenario.unload(this.context);
                this.clearScenarioEntities();
                this.activeScenario.load(this.context, {
                    isHost: this.context.isHost,
                    seed: this.context.sessionConfig.seed,
                    reason: 'reload'
                });
                this.refreshActiveObjectModules();
            }
            return;
        }

        this.activeScenario.applyConfig?.(this.context, this.context.sessionConfig);
    }

    public getSpawnPoint(index: number): { position: THREE.Vector3, yaw: number } {
        const spawn = this.activeScenario.getSpawnPoint(index);

        return {
            position: new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z),
            yaw: spawn.yaw
        };
    }

    public getActiveScenario(): IScenarioModule {
        return this.activeScenario;
    }

    public getAvailableObjectModules() {
        return this.objectModuleRegistry.list();
    }

    public getAvailableObjectModuleIds(): string[] {
        return this.objectModuleRegistry.listIds();
    }

    public spawnObjectModule(id: string, config: IObjectSpawnConfig = {}) {
        const entity = this.objectModuleRegistry.spawn(id, this.context, config);
        if (!entity) {
            console.warn(`[SessionRuntime] Failed to spawn object module: ${id}`);
            return null;
        }

        this.context.runtime.entity.addEntity(entity);
        this.scenarioEntityIds.add(entity.id);
        return entity;
    }

    public registerScenario(scenario: IScenarioModule): void {
        this.scenarioRegistry.register(scenario);
    }

    public getAvailableScenarios(): IScenarioModule[] {
        return this.scenarioRegistry.list();
    }

    public getAvailableScenarioIds(): string[] {
        return this.scenarioRegistry.listIds();
    }

    public switchScenario(id: string, options: Partial<IScenarioLoadOptions> = {}): boolean {
        const nextScenario = this.scenarioRegistry.get(id);
        if (!nextScenario) {
            console.warn(`[SessionRuntime] Cannot switch to unknown scenario: ${id}`);
            return false;
        }

        if (nextScenario.id === this.activeScenario.id) {
            return true;
        }

        this.activeScenario.unload(this.context);
        this.clearScenarioEntities();
        this.activeScenario = nextScenario;
        this.context.sessionConfig = { ...this.context.sessionConfig, activeScenarioId: nextScenario.id };
        this._seed = options.seed ?? this.context.sessionConfig.seed;

        if (this.scene) {
            this.activeScenario.load(this.context, {
                isHost: this.context.isHost,
                seed: options.seed ?? this.context.sessionConfig.seed,
                reason: options.reason ?? 'scenario_switch'
            });
        }

        this.refreshActiveObjectModules();
        this.repositionLocalPlayerForActiveScenario();

        return true;
    }

    public getDesktopLayout(index: number, total: number): IDesktopScreenLayout {
        if (this.activeScenario.getDesktopLayout) {
            return this.activeScenario.getDesktopLayout(index, total);
        }
        // Fallback
        return {
            position: [0, 1.5 + index * 0.1, -2.4],
            billboard: true
        };
    }

    public toggleHologram(visible: boolean): void {
        this.activeScenario.setHologramVisible?.(visible);
    }

    private refreshActiveObjectModules(): void {
        this.objectModuleRegistry.replaceAll(this.activeScenario.getObjectModules?.() || []);
    }

    private clearScenarioEntities(): void {
        for (const entityId of this.scenarioEntityIds) {
            this.context.runtime.entity.removeEntity(entityId);
        }
        this.scenarioEntityIds.clear();
    }

    private repositionLocalPlayerForActiveScenario(): void {
        const localPlayer = this.context.localPlayer;
        if (!localPlayer || !localPlayer.teleportTo) return;

        const spawnIndex = this.context.isHost ? 0 : (this.assignedSpawnIndex ?? 0);
        const spawn = this.getSpawnPoint(spawnIndex);
        localPlayer.teleportTo(spawn.position, spawn.yaw, { targetSpace: 'player' });
    }
}
