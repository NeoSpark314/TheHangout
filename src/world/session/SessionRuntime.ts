import * as THREE from 'three';
import { AppContext, ISessionConfig } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { IDesktopScreenLayout } from '../../shared/contracts/IDesktopScreenLayout';
import { DefaultHangoutScenario } from '../../content/scenarios/defaultHangout/DefaultHangoutScenario';
import type { IObjectSpawnConfig } from '../../content/contracts/IObjectModule';
import type { IObjectReplicationEmitOptions } from '../../content/contracts/IReplicatedObjectInstance';
import type { ISpawnedObjectInstance } from '../../content/contracts/ISpawnedObjectInstance';
import type { IScenarioLoadOptions, IScenarioModule } from '../../content/contracts/IScenarioModule';
import { ObjectInstanceRegistry } from '../../content/runtime/ObjectInstanceRegistry';
import { ObjectModuleRegistry } from '../../content/runtime/ObjectModuleRegistry';
import { ScenarioRegistry } from '../../content/runtime/ScenarioRegistry';
import { WideCircleScenario } from '../../content/scenarios/wideCircle/WideCircleScenario';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';

export class SessionRuntime implements IUpdatable {
    public scene: THREE.Scene | null = null;
    private _seed: number = 0;
    private hasGroundPhysics: boolean = false;
    private isInitialized: boolean = false;
    private readonly objectInstanceRegistry: ObjectInstanceRegistry;
    private readonly objectModuleRegistry = new ObjectModuleRegistry();
    private readonly scenarioRegistry = new ScenarioRegistry();
    private activeScenario: IScenarioModule;
    public assignedSpawnIndex?: number;

    constructor(private context: AppContext) {
        this.objectInstanceRegistry = new ObjectInstanceRegistry(context);
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

    public init(scene: THREE.Scene | null): void {
        try {
            this.scene = scene;
            this._seed = this.context.sessionConfig.seed;
            const configuredScenario = this.scenarioRegistry.get(this.context.sessionConfig.activeScenarioId);
            if (configuredScenario) {
                this.activeScenario = configuredScenario;
            }
            this.refreshActiveObjectModules();
            this.activeScenario.load(this.context, {
                isHost: this.context.isHost,
                seed: this.context.sessionConfig.seed,
                reason: 'session_start'
            });
            this.isInitialized = true;
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
        this.objectInstanceRegistry.update(delta);
    }

    public applySessionConfigUpdate(
        newConfig: Partial<ISessionConfig> & { assignedSpawnIndex?: number },
        onApplied?: () => void
    ): boolean {
        const oldSeed = this.context.sessionConfig.seed;
        const oldScenarioId = this.context.sessionConfig.activeScenarioId;

        if (newConfig.assignedSpawnIndex !== undefined) {
            this.assignedSpawnIndex = newConfig.assignedSpawnIndex;
            delete newConfig.assignedSpawnIndex;
        }

        const nextConfig = { ...this.context.sessionConfig, ...newConfig as ISessionConfig };

        const scenarioChanged = nextConfig.activeScenarioId !== oldScenarioId;

        if (scenarioChanged) {
            if (!this.scenarioRegistry.has(nextConfig.activeScenarioId)) {
                console.warn(`[SessionRuntime] Cannot apply config with unknown scenario: ${nextConfig.activeScenarioId}`);
                return false;
            }

            const previousEntityCount = this.context.runtime.entity.entities.size;
            console.info(
                `[SessionRuntime] Switching scenario ${oldScenarioId} -> ${nextConfig.activeScenarioId}` +
                ` (reason=scenario_switch, entities_before=${previousEntityCount})`
            );

            // Validate the scenario before mutating shared session config so a bad
            // admin/client payload cannot leave the runtime advertising a scenario
            // that never actually became active.
            this.context.sessionConfig = nextConfig;
            const applied = this.switchScenario(
                this.context.sessionConfig.activeScenarioId,
                {
                    seed: this.context.sessionConfig.seed,
                    reason: 'scenario_switch'
                },
                () => {
                    console.info(
                        `[SessionRuntime] Scenario switch completed` +
                        ` (active=${this.activeScenario.id}, entities_after=${this.context.runtime.entity.entities.size})`
                    );
                    this.emitSessionConfigApplied();
                    onApplied?.();
                }
            );
            if (!applied) {
                console.info(
                    `[SessionRuntime] Scenario switch failed` +
                    ` (active=${this.activeScenario.id}, entities_after=${this.context.runtime.entity.entities.size})`
                );
            }
            return applied;
        }

        this.context.sessionConfig = nextConfig;

        if (newConfig.seed !== undefined && newConfig.seed !== oldSeed) {
            this._seed = this.context.sessionConfig.seed;
            const previousEntityCount = this.context.runtime.entity.entities.size;
            console.info(
                `[SessionRuntime] Reloading scenario ${this.activeScenario.id}` +
                ` (reason=reload, seed=${this.context.sessionConfig.seed}, entities_before=${previousEntityCount})`
            );
            if (this.isInitialized) {
                this.activeScenario.unload(this.context);
                this.clearScenarioOwnedState();
                this.activeScenario.load(this.context, {
                    isHost: this.context.isHost,
                    seed: this.context.sessionConfig.seed,
                    reason: 'reload'
                });
                this.refreshActiveObjectModules();
            }
            console.info(
                `[SessionRuntime] Scenario reload completed` +
                ` (active=${this.activeScenario.id}, entities_after=${this.context.runtime.entity.entities.size})`
            );
            this.emitSessionConfigApplied();
            onApplied?.();
            return true;
        }

        this.activeScenario.applyConfig?.(this.context, this.context.sessionConfig);
        this.emitSessionConfigApplied();
        onApplied?.();
        return true;
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

    public getObjectModuleDefinition(moduleId: string) {
        return this.objectModuleRegistry.get(moduleId);
    }

    public spawnObjectInstance(id: string, config: IObjectSpawnConfig = {}): ISpawnedObjectInstance | null {
        const instance = this.objectModuleRegistry.spawn(id, this.context, config);
        if (!instance) {
            console.warn(`[SessionRuntime] Failed to spawn object module: ${id}`);
            return null;
        }

        this.objectInstanceRegistry.add(instance);
        return instance;
    }

    public spawnObjectModule(id: string, config: IObjectSpawnConfig = {}) {
        const instance = this.spawnObjectInstance(id, config);
        if (!instance) return null;
        return instance.getPrimaryEntity?.() ?? instance;
    }

    public spawnPortableObjectModule(id: string, config: IObjectSpawnConfig = {}) {
        const module = this.objectModuleRegistry.get(id);
        if (!module) {
            console.warn(`[SessionRuntime] Cannot spawn unknown object module: ${id}`);
            return null;
        }
        if (module.portable === false) {
            console.warn(`[SessionRuntime] Refusing portable spawn for non-portable module: ${id}`);
            return null;
        }
        return this.spawnObjectModule(id, config);
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

    public switchScenario(
        id: string,
        options: Partial<IScenarioLoadOptions> = {},
        onSwitched?: () => void
    ): boolean {
        const nextScenario = this.scenarioRegistry.get(id);
        if (!nextScenario) {
            console.warn(`[SessionRuntime] Cannot switch to unknown scenario: ${id}`);
            return false;
        }

        if (nextScenario.id === this.activeScenario.id) {
            onSwitched?.();
            return true;
        }

        if (this.isInitialized) {
            const transition = this.context.runtime.worldTransition;
            if (transition) {
                transition.transitionScenario(() => {
                    this.completeScenarioSwitch(nextScenario, options);
                    onSwitched?.();
                });
            } else {
                this.completeScenarioSwitch(nextScenario, options);
                onSwitched?.();
            }
        } else {
            this.completeScenarioSwitch(nextScenario, options);
            onSwitched?.();
        }

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

    public getObjectInstance(instanceId: string): ISpawnedObjectInstance | undefined {
        return this.objectInstanceRegistry.get(instanceId);
    }

    public getFirstObjectInstanceByModuleId(moduleId: string): ISpawnedObjectInstance | undefined {
        return this.objectInstanceRegistry.getFirstByModuleId(moduleId);
    }

    public emitObjectInstanceEvent(
        instanceId: string,
        eventType: string,
        data: unknown,
        options?: IObjectReplicationEmitOptions
    ): void {
        this.objectInstanceRegistry.emit(instanceId, eventType, data, options);
    }

    public removeObjectInstance(instanceId: string): void {
        this.objectInstanceRegistry.remove(instanceId);
    }

    private refreshActiveObjectModules(): void {
        this.objectModuleRegistry.replaceAll(this.activeScenario.getObjectModules?.() || []);
    }

    private clearScenarioOwnedState(): void {
        this.context.runtime.drawing?.clear?.();
        this.objectInstanceRegistry.removeAll();
    }

    private completeScenarioSwitch(nextScenario: IScenarioModule, options: Partial<IScenarioLoadOptions>): void {
        this.activeScenario.unload(this.context);
        this.clearScenarioOwnedState();
        this.activeScenario = nextScenario;
        this.context.sessionConfig = { ...this.context.sessionConfig, activeScenarioId: nextScenario.id };
        this._seed = options.seed ?? this.context.sessionConfig.seed;
        this.refreshActiveObjectModules();

        if (this.isInitialized) {
            this.activeScenario.load(this.context, {
                isHost: this.context.isHost,
                seed: options.seed ?? this.context.sessionConfig.seed,
                reason: options.reason ?? 'scenario_switch'
            });
        }

        this.repositionLocalPlayerForActiveScenario();
    }

    private repositionLocalPlayerForActiveScenario(): void {
        const localPlayer = this.context.localPlayer;
        if (!localPlayer || !localPlayer.teleportTo) return;

        const spawnIndex = this.context.isHost ? 0 : (this.assignedSpawnIndex ?? 0);
        const spawn = this.getSpawnPoint(spawnIndex);
        localPlayer.teleportTo(spawn.position, spawn.yaw, { targetSpace: 'player' });
    }

    private emitSessionConfigApplied(): void {
        eventBus.emit(EVENTS.SESSION_CONFIG_APPLIED);
    }
}
