import * as THREE from 'three';
import { AppContext, ISessionConfig } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { IDesktopScreenLayout } from '../../shared/contracts/IDesktopScreenLayout';
import type { IObjectSpawnConfig } from '../../content/contracts/IObjectModule';
import type { IObjectModule } from '../../content/contracts/IObjectModule';
import type { IObjectReplicationEmitOptions } from '../../content/contracts/IReplicatedObjectInstance';
import type { IScenarioReplicationEmitOptions, IReplicatedScenarioModule } from '../../content/contracts/IReplicatedScenarioModule';
import type { ISpawnedObjectInstance } from '../../content/contracts/ISpawnedObjectInstance';
import type { IScenarioLoadOptions, IScenarioModule } from '../../content/contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../content/contracts/IScenarioPlugin';
import { ObjectInstanceRegistry } from '../../content/runtime/ObjectInstanceRegistry';
import { ObjectModuleRegistry } from '../../content/runtime/ObjectModuleRegistry';
import { ScenarioPluginRegistry } from '../../content/runtime/ScenarioPluginRegistry';
import { ScenarioReplicationHost } from '../../content/runtime/ScenarioReplicationHost';
import { ScenarioRuntimeContext } from '../../content/runtime/ScenarioRuntimeContext';
import { TriggerZoneRegistry } from '../../content/runtime/TriggerZoneRegistry';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import type { ITriggerBoxOptions, ITriggerZoneHandle } from '../../content/contracts/IObjectRuntimeContext';
import type { IScenarioContext } from '../../content/contracts/IScenarioContext';

export class ScenarioManager implements IUpdatable {
    public scene: THREE.Scene | null = null;
    private _seed: number = 0;
    private hasGroundPhysics: boolean = false;
    private isInitialized: boolean = false;
    private readonly objectInstanceRegistry: ObjectInstanceRegistry;
    private readonly objectModuleRegistry = new ObjectModuleRegistry();
    private readonly knownObjectModules = new Map<string, IObjectModule>();
    private readonly scenarioRegistry = new ScenarioPluginRegistry();
    private readonly scenarioReplicationHost: ScenarioReplicationHost;
    private readonly triggerZoneRegistry: TriggerZoneRegistry;
    private activeScenarioPlugin: IScenarioPlugin;
    private activeScenario: IScenarioModule | null = null;
    private activeScenarioContext: ScenarioRuntimeContext | null = null;
    private activeScenarioVisualsLoaded = false;
    private scenarioLoadPromise: Promise<void> | null = null;
    public assignedSpawnIndex?: number;

    constructor(
        private context: AppContext,
        scenarioPlugins: IScenarioPlugin[],
        defaultScenarioId?: string
    ) {
        this.objectInstanceRegistry = new ObjectInstanceRegistry(context);
        this.scenarioReplicationHost = new ScenarioReplicationHost(context);
        this.triggerZoneRegistry = new TriggerZoneRegistry(context);
        if (scenarioPlugins.length === 0) {
            throw new Error('[ScenarioManager] At least one scenario plugin must be registered.');
        }

        for (const plugin of scenarioPlugins) {
            this.scenarioRegistry.register(plugin);
            this.indexScenarioObjectModules(plugin);
        }

        this.activeScenarioPlugin = this.resolveInitialScenarioPlugin(defaultScenarioId);
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

    public async init(scene: THREE.Scene | null): Promise<void> {
        try {
            this.scene = scene;
            this._seed = this.context.sessionConfig.seed;
            const configuredPlugin = this.scenarioRegistry.get(this.context.sessionConfig.activeScenarioId);
            if (configuredPlugin && configuredPlugin.id !== this.activeScenarioPlugin.id) {
                this.activeScenarioPlugin = configuredPlugin;
            }
            await this.ensureScenarioReady(this.activeScenarioPlugin);
            this.loadActiveScenario({
                isHost: this.context.isHost,
                seed: this.context.sessionConfig.seed,
                reason: 'session_start'
            });
            this.requireActiveScenario().applyConfig?.(this.requireActiveScenarioContext(), this.context.sessionConfig.scenarioConfig || {});
            this.attachScenarioReplicationIfNeeded();
            this.isInitialized = true;
        } catch (e) {
            console.error('[ScenarioManager] init crashed:', e);
        }
    }

    public ensureGroundPhysics(size: number = 25): void {
        if (!this.hasGroundPhysics && this.context.runtime.physics) {
            this.context.runtime.physics.createGround(size);
            this.hasGroundPhysics = true;
        }
    }

    public update(delta: number): void {
        this.activeScenario?.update(delta);
        this.triggerZoneRegistry.update();
        this.objectInstanceRegistry.update(delta);
    }

    public createTriggerBox(options: ITriggerBoxOptions): ITriggerZoneHandle | null {
        return this.triggerZoneRegistry.createBox(options);
    }

    public async applySessionConfigUpdate(
        newConfig: Partial<ISessionConfig> & { assignedSpawnIndex?: number },
        onApplied?: () => void
    ): Promise<boolean> {
        const currentConfig = this.context.sessionConfig;
        const oldSeed = currentConfig.seed;
        const oldScenarioId = currentConfig.activeScenarioId;

        if (newConfig.assignedSpawnIndex !== undefined) {
            this.assignedSpawnIndex = newConfig.assignedSpawnIndex;
            delete newConfig.assignedSpawnIndex;
        }

        const scenarioChangeRequested = newConfig.activeScenarioId !== undefined && newConfig.activeScenarioId !== oldScenarioId;
        const seedChanged = newConfig.seed !== undefined && newConfig.seed !== oldSeed;
        const nextConfig = this.resolveNextSessionConfig(newConfig, { scenarioChanged: scenarioChangeRequested, seedChanged });
        const scenarioChanged = nextConfig.activeScenarioId !== oldScenarioId;

        if (scenarioChanged) {
            if (!this.scenarioRegistry.has(nextConfig.activeScenarioId)) {
                console.warn(`[ScenarioManager] Cannot apply config with unknown scenario: ${nextConfig.activeScenarioId}`);
                return false;
            }

            const previousEntityCount = this.context.runtime.entity.entities.size;
            console.info(
                `[ScenarioManager] Switching scenario ${oldScenarioId} -> ${nextConfig.activeScenarioId}` +
                ` (reason=scenario_switch, entities_before=${previousEntityCount})`
            );

            // Validate the scenario before mutating shared session config so a bad
            // admin/client payload cannot leave the runtime advertising a scenario
            // that never actually became active.
            this.context.sessionConfig = nextConfig;
            const applied = await this.switchScenario(
                this.context.sessionConfig.activeScenarioId,
                {
                    seed: this.context.sessionConfig.seed,
                    reason: 'scenario_switch'
                },
                () => {
                    const activeScenario = this.requireActiveScenario();
                    console.info(
                        `[ScenarioManager] Scenario switch completed` +
                        ` (active=${activeScenario.id}, entities_after=${this.context.runtime.entity.entities.size})`
                    );
                    this.emitSessionConfigApplied();
                    onApplied?.();
                }
            );
            if (!applied) {
                const activeScenarioId = this.activeScenario?.id ?? this.activeScenarioPlugin.id;
                console.info(
                    `[ScenarioManager] Scenario switch failed` +
                    ` (active=${activeScenarioId}, entities_after=${this.context.runtime.entity.entities.size})`
                );
            }
            return applied;
        }

        this.context.sessionConfig = nextConfig;

        if (seedChanged) {
            this._seed = this.context.sessionConfig.seed;
            const previousEntityCount = this.context.runtime.entity.entities.size;
            const activeScenario = this.requireActiveScenario();
            console.info(
                `[ScenarioManager] Reloading scenario ${activeScenario.id}` +
                ` (reason=reload, seed=${this.context.sessionConfig.seed}, entities_before=${previousEntityCount})`
            );
            if (this.isInitialized) {
                this.scenarioReplicationHost.detach();
                this.unloadActiveScenario();
                await this.ensureScenarioReady(this.activeScenarioPlugin, { forceReload: true });
                this.loadActiveScenario({
                    isHost: this.context.isHost,
                    seed: this.context.sessionConfig.seed,
                    reason: 'reload'
                });
                this.requireActiveScenario().applyConfig?.(this.requireActiveScenarioContext(), this.context.sessionConfig.scenarioConfig || {});
                this.attachScenarioReplicationIfNeeded();
            }
            const reloadedScenario = this.requireActiveScenario();
            console.info(
                `[ScenarioManager] Scenario reload completed` +
                ` (active=${reloadedScenario.id}, entities_after=${this.context.runtime.entity.entities.size})`
            );
            this.emitSessionConfigApplied();
            onApplied?.();
            return true;
        }

        this.requireActiveScenario().applyConfig?.(this.requireActiveScenarioContext(), this.context.sessionConfig.scenarioConfig || {});
        this.emitSessionConfigApplied();
        onApplied?.();
        return true;
    }

    public getSpawnPoint(index: number): { position: THREE.Vector3, yaw: number } {
        const spawn = this.requireActiveScenario().getSpawnPoint(index);

        return {
            position: new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z),
            yaw: spawn.yaw
        };
    }

    public getActiveScenario(): IScenarioModule {
        return this.requireActiveScenario();
    }

    public getActiveScenarioContext(): IScenarioContext {
        return this.requireActiveScenarioContext();
    }

    public getObjectModuleDefinition(moduleId: string) {
        return this.resolveObjectModuleDefinition(moduleId);
    }

    public spawnObjectInstance(id: string, config: IObjectSpawnConfig = {}): ISpawnedObjectInstance | null {
        let instance = this.objectModuleRegistry.spawn(id, this.context, config);
        if (!instance && this.ensureObjectModuleRegistered(id)) {
            instance = this.objectModuleRegistry.spawn(id, this.context, config);
        }
        if (!instance) {
            this.refreshActiveObjectModules();
            if (this.ensureObjectModuleRegistered(id)) {
                instance = this.objectModuleRegistry.spawn(id, this.context, config);
            }
        }
        if (!instance) {
            const activeScenarioId = this.activeScenario?.id ?? this.activeScenarioPlugin.id;
            console.warn(
                `[ScenarioManager] Failed to spawn object module: ${id}`,
                { availableModules: this.objectModuleRegistry.listIds(), activeScenario: activeScenarioId }
            );
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
            console.warn(`[ScenarioManager] Cannot spawn unknown object module: ${id}`);
            return null;
        }
        if (module.portable === false) {
            console.warn(`[ScenarioManager] Refusing portable spawn for non-portable module: ${id}`);
            return null;
        }
        return this.spawnObjectModule(id, config);
    }

    public registerScenario(plugin: IScenarioPlugin): void {
        this.scenarioRegistry.register(plugin);
        this.indexScenarioObjectModules(plugin);
    }

    public getAvailableScenarios(): IScenarioPlugin[] {
        return this.scenarioRegistry.list();
    }

    public getAvailableScenarioIds(): string[] {
        return this.scenarioRegistry.listIds();
    }

    public async switchScenario(
        id: string,
        options: Partial<IScenarioLoadOptions> = {},
        onSwitched?: () => void
    ): Promise<boolean> {
        const nextPlugin = this.scenarioRegistry.get(id);
        if (!nextPlugin) {
            console.warn(`[ScenarioManager] Cannot switch to unknown scenario: ${id}`);
            return false;
        }

        if (nextPlugin.id === this.activeScenarioPlugin.id) {
            onSwitched?.();
            return true;
        }

        this.closeMenuUiForScenarioTransition();

        if (this.isInitialized) {
            const transition = this.context.runtime.worldTransition;
            if (transition) {
                await new Promise<void>((resolve, reject) => {
                    transition.transitionScenario(() => {
                        void this.completeScenarioSwitch(nextPlugin, options).then(() => {
                            onSwitched?.();
                            resolve();
                        }).catch(reject);
                    });
                });
            } else {
                await this.completeScenarioSwitch(nextPlugin, options);
                onSwitched?.();
            }
        } else {
            await this.completeScenarioSwitch(nextPlugin, options);
            onSwitched?.();
        }

        return true;
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

    public emitScenarioEvent(
        eventType: string,
        data: unknown,
        options?: IScenarioReplicationEmitOptions
    ): void {
        this.scenarioReplicationHost.emit(eventType, data, options);
    }

    private refreshActiveObjectModules(): void {
        this.objectModuleRegistry.replaceAll(this.activeScenario?.getObjectModules?.() || []);
        for (const [moduleId, module] of this.knownObjectModules.entries()) {
            if (!this.objectModuleRegistry.get(moduleId)) {
                this.objectModuleRegistry.register(module);
            }
        }
    }

    private ensureObjectModuleRegistered(moduleId: string): boolean {
        if (this.objectModuleRegistry.get(moduleId)) {
            return true;
        }
        const module = this.knownObjectModules.get(moduleId);
        if (!module) {
            return false;
        }
        this.objectModuleRegistry.register(module);
        return true;
    }

    private resolveObjectModuleDefinition(moduleId: string) {
        return this.objectModuleRegistry.get(moduleId) ?? this.knownObjectModules.get(moduleId);
    }

    private indexScenarioObjectModules(plugin: IScenarioPlugin): void {
        const modules = plugin.objectModules ?? [];
        for (const module of modules) {
            this.knownObjectModules.set(module.id, module);
        }
    }

    private clearScenarioOwnedState(): void {
        const removedInstances = this.objectInstanceRegistry.list().map((instance) => ({
            id: instance.id,
            primaryEntityId: instance.getPrimaryEntity?.()?.id ?? null,
            ownedEntityIds: instance.getOwnedEntityIds?.() ?? []
        }));
        const scenarioModuleIds = new Set((this.activeScenario?.getObjectModules?.() ?? []).map((module) => module.id));

        this.context.runtime.skills.drawing?.clear?.();
        this.objectInstanceRegistry.removeAll();
        this.context.runtime.physics?.flushPendingRemovals?.();
        this.assertScenarioTeardownClean(removedInstances, scenarioModuleIds);
    }

    private async completeScenarioSwitch(nextPlugin: IScenarioPlugin, options: Partial<IScenarioLoadOptions>): Promise<void> {
        this.scenarioReplicationHost.detach();
        this.unloadActiveScenario();
        this.activeScenario = null;
        this.activeScenarioContext = null;
        this.activeScenarioPlugin = nextPlugin;
        this.context.sessionConfig = { ...this.context.sessionConfig, activeScenarioId: nextPlugin.id };
        this._seed = options.seed ?? this.context.sessionConfig.seed;
        await this.ensureScenarioReady(nextPlugin, { forceReload: true });

        if (this.isInitialized) {
            this.loadActiveScenario({
                isHost: this.context.isHost,
                seed: options.seed ?? this.context.sessionConfig.seed,
                reason: options.reason ?? 'scenario_switch'
            });
            this.requireActiveScenario().applyConfig?.(this.requireActiveScenarioContext(), this.context.sessionConfig.scenarioConfig || {});
            this.attachScenarioReplicationIfNeeded();
        }

        this.repositionLocalPlayerForActiveScenario();
    }

    private createScenarioContext(): ScenarioRuntimeContext {
        return new ScenarioRuntimeContext(this.context, this);
    }

    private loadActiveScenario(options: IScenarioLoadOptions): void {
        const activeScenario = this.requireActiveScenario();
        const activeScenarioContext = this.requireActiveScenarioContext();
        activeScenario.loadWorld(activeScenarioContext, options);
        this.activeScenarioVisualsLoaded = false;
        if (activeScenarioContext.scene.isRenderingAvailable()) {
            activeScenario.loadVisuals?.(activeScenarioContext, options);
            this.activeScenarioVisualsLoaded = true;
        }
    }

    private unloadActiveScenario(): void {
        if (!this.activeScenario || !this.activeScenarioContext) {
            return;
        }
        if (this.activeScenarioVisualsLoaded) {
            this.activeScenario.unloadVisuals?.(this.activeScenarioContext);
            this.activeScenarioVisualsLoaded = false;
        }
        this.activeScenario.unloadWorld(this.activeScenarioContext);
        this.activeScenarioContext.runCleanupCallbacks();
        this.clearScenarioOwnedState();
    }

    private attachScenarioReplicationIfNeeded(): void {
        if (this.activeScenario && isReplicatedScenarioModule(this.activeScenario)) {
            this.scenarioReplicationHost.attach(this.activeScenario);
            return;
        }

        this.scenarioReplicationHost.detach();
    }

    private resolveInitialScenarioPlugin(defaultScenarioId?: string): IScenarioPlugin {
        if (defaultScenarioId) {
            const configuredDefault = this.scenarioRegistry.get(defaultScenarioId);
            if (configuredDefault) {
                return configuredDefault;
            }
        }

        const configuredSessionScenario = this.scenarioRegistry.get(this.context.sessionConfig.activeScenarioId);
        if (configuredSessionScenario) {
            return configuredSessionScenario;
        }

        return this.scenarioRegistry.list()[0];
    }

    private repositionLocalPlayerForActiveScenario(): void {
        const localPlayer = this.context.localPlayer;
        if (!localPlayer || !localPlayer.teleportTo || !this.activeScenario) return;

        const spawnIndex = this.context.isHost ? 0 : (this.assignedSpawnIndex ?? 0);
        const spawn = this.getSpawnPoint(spawnIndex);
        localPlayer.teleportTo(spawn.position, spawn.yaw, { targetSpace: 'player' });
    }

    private emitSessionConfigApplied(): void {
        eventBus.emit(EVENTS.SESSION_CONFIG_APPLIED);
    }

    private closeMenuUiForScenarioTransition(): void {
        if (!this.context.isMenuOpen) return;

        this.context.runtime.menu?.close();
    }

    private assertScenarioTeardownClean(
        removedInstances: Array<{ id: string; primaryEntityId: string | null; ownedEntityIds: string[] }>,
        scenarioModuleIds: Set<string>
    ): void {
        const lingeringInstances = this.objectInstanceRegistry.list();
        const lingeringEntities = Array.from(this.context.runtime.entity.entities.values()).filter((entity) => {
            if (entity.type === 'PLAYER_AVATAR') return false;

            const candidate = entity as { moduleId?: string };
            if (candidate.moduleId && scenarioModuleIds.has(candidate.moduleId)) {
                return true;
            }

            return removedInstances.some((instance) =>
                entity.id === instance.id ||
                entity.id === instance.primaryEntityId ||
                instance.ownedEntityIds.includes(entity.id) ||
                entity.id.startsWith(`${instance.id}:`)
            );
        });

        if (lingeringInstances.length === 0 && lingeringEntities.length === 0) {
            return;
        }

        const message =
            `[ScenarioManager] Scenario teardown left runtime-owned state behind ` +
            `(scenario=${this.activeScenario?.id || this.activeScenarioPlugin.id}, instances=${lingeringInstances.map((instance) => instance.id).join(',') || 'none'}, ` +
            `entities=${lingeringEntities.map((entity) => entity.id).join(',') || 'none'})`;

        throw new Error(message);
    }

    private resolveNextSessionConfig(
        newConfig: Partial<ISessionConfig>,
        options: { scenarioChanged: boolean; seedChanged: boolean }
    ): ISessionConfig {
        const currentConfig = this.context.sessionConfig;
        const nextConfig: ISessionConfig = {
            ...currentConfig,
            ...newConfig
        };

        const incomingEpoch = newConfig.scenarioEpoch;
        if (typeof incomingEpoch === 'number') {
            nextConfig.scenarioEpoch = incomingEpoch;
            return nextConfig;
        }

        if (options.scenarioChanged || options.seedChanged) {
            nextConfig.scenarioEpoch = currentConfig.scenarioEpoch + 1;
            return nextConfig;
        }

        nextConfig.scenarioEpoch = currentConfig.scenarioEpoch;
        return nextConfig;
    }

    private async ensureScenarioReady(
        plugin: IScenarioPlugin,
        options: { forceReload?: boolean } = {}
    ): Promise<void> {
        if (!options.forceReload && this.activeScenario && this.activeScenarioPlugin.id === plugin.id) {
            return;
        }

        if (this.scenarioLoadPromise) {
            await this.scenarioLoadPromise;
            if (!options.forceReload && this.activeScenario && this.activeScenarioPlugin.id === plugin.id) {
                return;
            }
        }

        this.scenarioLoadPromise = (async () => {
            const scenario = await plugin.create();
            this.activeScenario = scenario;
            this.activeScenarioContext = this.createScenarioContext();
            for (const module of scenario.getObjectModules?.() ?? []) {
                this.knownObjectModules.set(module.id, module);
            }
            this.refreshActiveObjectModules();
        })();

        try {
            await this.scenarioLoadPromise;
        } finally {
            this.scenarioLoadPromise = null;
        }
    }

    private requireActiveScenario(): IScenarioModule {
        if (!this.activeScenario) {
            throw new Error('[ScenarioManager] Active scenario is not loaded yet.');
        }
        return this.activeScenario;
    }

    private requireActiveScenarioContext(): ScenarioRuntimeContext {
        if (!this.activeScenarioContext) {
            throw new Error('[ScenarioManager] Active scenario context is not ready yet.');
        }
        return this.activeScenarioContext;
    }
}

function isReplicatedScenarioModule(value: IScenarioModule): value is IReplicatedScenarioModule {
    const candidate = value as Partial<IReplicatedScenarioModule>;
    return typeof candidate.replicationKey === 'string'
        && typeof candidate.onScenarioReplicationEvent === 'function';
}



