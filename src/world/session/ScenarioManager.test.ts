import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../app/AppContext';
import type { IObjectModule } from '../../content/contracts/IObjectModule';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../content/contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../content/contracts/IScenarioPlugin';
import type { IScenarioContext } from '../../content/contracts/IScenarioContext';
import { ScenarioManager } from './ScenarioManager';

class TestObjectModule implements IObjectModule {
    public readonly id = 'test-object-module';
    public readonly displayName = 'Test Object Module';

    public spawn(_context: any, _config: any): null {
        return null;
    }
}

class TestScenario implements IScenarioModule {
    public readonly id = 'test-scenario';
    public readonly displayName = 'Test Scenario';

    constructor(private readonly modules: IObjectModule[]) { }

    public loadWorld(_context: IScenarioContext, _options: IScenarioLoadOptions): void { }
    public unloadWorld(_context: IScenarioContext): void { }
    public update(_delta: number): void { }
    public getSpawnPoint(_index: number): IScenarioSpawnPoint {
        return {
            position: { x: 0, y: 0.2, z: 0 },
            yaw: 0
        };
    }
    public getObjectModules(): IObjectModule[] {
        return this.modules;
    }
}

class LifecycleScenario implements IScenarioModule {
    public readonly id = 'lifecycle-scenario';
    public readonly displayName = 'Lifecycle Scenario';

    constructor(private readonly calls: string[]) { }

    public loadWorld(_context: IScenarioContext, _options: IScenarioLoadOptions): void {
        this.calls.push('loadWorld');
    }

    public loadVisuals(_context: IScenarioContext, _options: IScenarioLoadOptions): void {
        this.calls.push('loadVisuals');
    }

    public unloadVisuals(_context: IScenarioContext): void {
        this.calls.push('unloadVisuals');
    }

    public unloadWorld(_context: IScenarioContext): void {
        this.calls.push('unloadWorld');
    }

    public update(_delta: number): void { }

    public getSpawnPoint(_index: number): IScenarioSpawnPoint {
        return {
            position: { x: 0, y: 0, z: 0 },
            yaw: 0
        };
    }
}

function createPlugin(options: { exposeMetadata: boolean }) {
    const modules = [new TestObjectModule()];
    let createCalls = 0;
    const plugin: IScenarioPlugin = {
        id: 'test-scenario',
        displayName: 'Test Scenario',
        objectModules: options.exposeMetadata ? modules : undefined,
        create() {
            createCalls += 1;
            return new TestScenario(modules);
        }
    };
    return {
        plugin,
        getCreateCalls: () => createCalls
    };
}

describe('ScenarioManager object module indexing', () => {
    it('uses plugin metadata for object-module lookup without scenario construction', () => {
        const app = new AppContext();
        const { plugin, getCreateCalls } = createPlugin({ exposeMetadata: true });

        const session = new ScenarioManager(app, [plugin], plugin.id);

        expect(getCreateCalls()).toBe(0);
        expect(session.getObjectModuleDefinition('test-object-module')).toBeTruthy();
        expect(getCreateCalls()).toBe(0);
    });

    it('learns object modules after the lazy scenario is initialized', async () => {
        const app = new AppContext();
        const { plugin, getCreateCalls } = createPlugin({ exposeMetadata: false });

        const session = new ScenarioManager(app, [plugin], plugin.id);

        expect(getCreateCalls()).toBe(0);
        expect(session.getObjectModuleDefinition('test-object-module')).toBeUndefined();

        await session.init(null);

        expect(getCreateCalls()).toBe(1);
        expect(session.getObjectModuleDefinition('test-object-module')).toBeTruthy();
    });
});

describe('ScenarioManager lifecycle split', () => {
    it('loads world and visuals when rendering is available', async () => {
        const app = new AppContext();
        app.setRuntime('render', { scene: new THREE.Scene() } as any);
        const calls: string[] = [];
        const plugin: IScenarioPlugin = {
            id: 'lifecycle-scenario',
            displayName: 'Lifecycle Scenario',
            create() {
                return new LifecycleScenario(calls);
            }
        };

        const session = new ScenarioManager(app, [plugin], plugin.id);
        await session.init(new THREE.Scene());

        expect(calls).toEqual(['loadWorld', 'loadVisuals']);
    });

    it('loads only world when rendering is unavailable', async () => {
        const app = new AppContext();
        const calls: string[] = [];
        const plugin: IScenarioPlugin = {
            id: 'lifecycle-scenario',
            displayName: 'Lifecycle Scenario',
            create() {
                return new LifecycleScenario(calls);
            }
        };

        const session = new ScenarioManager(app, [plugin], plugin.id);
        await session.init(null);

        expect(calls).toEqual(['loadWorld']);
    });

    it('unloads visuals before world during reload', async () => {
        const app = new AppContext();
        app.setRuntime('render', { scene: new THREE.Scene() } as any);
        app.setRuntime('entity', { entities: new Map() } as any);
        app.setRuntime('skills', { drawing: { clear: () => {} }, mount: {}, interaction: {} } as any);
        app.setRuntime('physics', { flushPendingRemovals: () => {} } as any);
        const calls: string[] = [];
        const plugin: IScenarioPlugin = {
            id: 'lifecycle-scenario',
            displayName: 'Lifecycle Scenario',
            create() {
                return new LifecycleScenario(calls);
            }
        };

        const session = new ScenarioManager(app, [plugin], plugin.id);
        await session.init(new THREE.Scene());
        calls.length = 0;

        await session.applySessionConfigUpdate({ seed: 2 });

        expect(calls).toEqual(['unloadVisuals', 'unloadWorld', 'loadWorld', 'loadVisuals']);
    });

    it('increments scenario epoch on reload when no epoch is supplied', async () => {
        const app = new AppContext();
        app.setRuntime('render', { scene: new THREE.Scene() } as any);
        app.setRuntime('entity', { entities: new Map() } as any);
        app.setRuntime('skills', { drawing: { clear: () => {} }, mount: {}, interaction: {} } as any);
        app.setRuntime('physics', { flushPendingRemovals: () => {} } as any);
        const plugin: IScenarioPlugin = {
            id: 'lifecycle-scenario',
            displayName: 'Lifecycle Scenario',
            create() {
                return new LifecycleScenario([]);
            }
        };

        const session = new ScenarioManager(app, [plugin], plugin.id);
        const initialEpoch = app.sessionConfig.scenarioEpoch;
        await session.init(new THREE.Scene());

        await session.applySessionConfigUpdate({ seed: 2 });

        expect(app.sessionConfig.scenarioEpoch).toBe(initialEpoch + 1);
    });

    it('applies an incoming scenario epoch during scenario switch', async () => {
        const app = new AppContext();
        app.setRuntime('render', { scene: new THREE.Scene() } as any);
        app.setRuntime('entity', { entities: new Map() } as any);
        app.setRuntime('skills', { drawing: { clear: () => {} }, mount: {}, interaction: {} } as any);
        app.setRuntime('physics', { flushPendingRemovals: () => {} } as any);
        const firstPlugin: IScenarioPlugin = {
            id: 'scenario-a',
            displayName: 'Scenario A',
            create() {
                return new LifecycleScenario([]);
            }
        };
        const secondPlugin: IScenarioPlugin = {
            id: 'scenario-b',
            displayName: 'Scenario B',
            create() {
                return new LifecycleScenario([]);
            }
        };

        const session = new ScenarioManager(app, [firstPlugin, secondPlugin], firstPlugin.id);
        await session.init(new THREE.Scene());

        await session.applySessionConfigUpdate({
            activeScenarioId: secondPlugin.id,
            scenarioEpoch: 9
        });

        expect(app.sessionConfig.activeScenarioId).toBe(secondPlugin.id);
        expect(app.sessionConfig.scenarioEpoch).toBe(9);
    });

    it('throws when scenario teardown leaves behind scenario-owned entities', async () => {
        const app = new AppContext();
        app.setRuntime('render', { scene: new THREE.Scene() } as any);
        app.setRuntime('entity', {
            entities: new Map([
                ['leaked-body', { id: 'leaked-body', type: 'PHYSICS_PROP', moduleId: 'test-object-module', isDestroyed: false }]
            ]),
            getEntity(id: string) {
                return (this.entities as Map<string, unknown>).get(id);
            },
            removeEntity(id: string) {
                (this.entities as Map<string, unknown>).delete(id);
            }
        } as any);
        app.setRuntime('skills', { drawing: { clear: () => {} }, mount: {}, interaction: {} } as any);
        app.setRuntime('physics', { flushPendingRemovals: () => {} } as any);
        const plugin: IScenarioPlugin = {
            id: 'test-scenario',
            displayName: 'Test Scenario',
            objectModules: [new TestObjectModule()],
            create() {
                return new TestScenario([new TestObjectModule()]);
            }
        };

        const session = new ScenarioManager(app, [plugin], plugin.id);
        await session.init(new THREE.Scene());

        await expect(session.applySessionConfigUpdate({ seed: 2 })).rejects.toThrow(/Scenario teardown left runtime-owned state behind/);
    });

    it('closes open menu UI before switching scenarios', async () => {
        const app = new AppContext();
        app.isMenuOpen = true;
        const closeMenu = vi.fn(() => {
            app.isMenuOpen = false;
        });
        app.setRuntime('menu', { close: closeMenu } as any);
        app.setRuntime('entity', { entities: new Map() } as any);
        app.setRuntime('skills', { drawing: { clear: () => {} }, mount: {}, interaction: {} } as any);
        app.setRuntime('physics', { flushPendingRemovals: () => {} } as any);
        const firstPlugin: IScenarioPlugin = {
            id: 'scenario-a',
            displayName: 'Scenario A',
            create() {
                return new LifecycleScenario([]);
            }
        };
        const secondPlugin: IScenarioPlugin = {
            id: 'scenario-b',
            displayName: 'Scenario B',
            create() {
                return new LifecycleScenario([]);
            }
        };

        const session = new ScenarioManager(app, [firstPlugin, secondPlugin], firstPlugin.id);

        await session.switchScenario(secondPlugin.id);

        expect(closeMenu).toHaveBeenCalledTimes(1);
        expect(app.isMenuOpen).toBe(false);
    });
});
