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
    it('uses plugin metadata for object-module lookup without extra scenario construction', () => {
        const app = new AppContext();
        const { plugin, getCreateCalls } = createPlugin({ exposeMetadata: true });

        const session = new ScenarioManager(app, [plugin], plugin.id);

        expect(getCreateCalls()).toBe(1);
        expect(session.getObjectModuleDefinition('test-object-module')).toBeTruthy();
        expect(getCreateCalls()).toBe(1);
    });

    it('falls back to a one-time scenario instantiation when plugin metadata is absent', () => {
        const app = new AppContext();
        const { plugin, getCreateCalls } = createPlugin({ exposeMetadata: false });

        const session = new ScenarioManager(app, [plugin], plugin.id);

        expect(getCreateCalls()).toBe(2);
        expect(session.getObjectModuleDefinition('test-object-module')).toBeTruthy();
        expect(getCreateCalls()).toBe(2);
    });
});

describe('ScenarioManager lifecycle split', () => {
    it('loads world and visuals when rendering is available', () => {
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
        session.init(new THREE.Scene());

        expect(calls).toEqual(['loadWorld', 'loadVisuals']);
    });

    it('loads only world when rendering is unavailable', () => {
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
        session.init(null);

        expect(calls).toEqual(['loadWorld']);
    });

    it('unloads visuals before world during reload', () => {
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
        session.init(new THREE.Scene());
        calls.length = 0;

        session.applySessionConfigUpdate({ seed: 2 });

        expect(calls).toEqual(['unloadVisuals', 'unloadWorld', 'loadWorld', 'loadVisuals']);
    });

    it('increments scenario epoch on reload when no epoch is supplied', () => {
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
        session.init(new THREE.Scene());

        session.applySessionConfigUpdate({ seed: 2 });

        expect(app.sessionConfig.scenarioEpoch).toBe(initialEpoch + 1);
    });

    it('applies an incoming scenario epoch during scenario switch', () => {
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
        session.init(new THREE.Scene());

        session.applySessionConfigUpdate({
            activeScenarioId: secondPlugin.id,
            scenarioEpoch: 9
        });

        expect(app.sessionConfig.activeScenarioId).toBe(secondPlugin.id);
        expect(app.sessionConfig.scenarioEpoch).toBe(9);
    });

    it('throws when scenario teardown leaves behind scenario-owned entities', () => {
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
        session.init(new THREE.Scene());

        expect(() => session.applySessionConfigUpdate({ seed: 2 })).toThrow(/Scenario teardown left runtime-owned state behind/);
    });

    it('closes open menu UI before switching scenarios', () => {
        const app = new AppContext();
        app.isMenuOpen = true;
        const closeFlatMenu = vi.fn();
        const closeMenu = vi.fn();
        app.setRuntime('ui', { closeMenu: closeFlatMenu } as any);
        app.setRuntime('vrUi', { closeMenu } as any);
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

        session.switchScenario(secondPlugin.id);

        expect(closeFlatMenu).toHaveBeenCalledTimes(1);
        expect(closeMenu).toHaveBeenCalledTimes(1);
        expect(app.isMenuOpen).toBe(false);
    });
});
