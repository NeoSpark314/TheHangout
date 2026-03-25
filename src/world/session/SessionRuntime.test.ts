import { describe, expect, it } from 'vitest';
import { AppContext } from '../../app/AppContext';
import type { IObjectModule } from '../../content/contracts/IObjectModule';
import type { IScenarioLoadOptions, IScenarioModule, IScenarioSpawnPoint } from '../../content/contracts/IScenarioModule';
import type { IScenarioPlugin } from '../../content/contracts/IScenarioPlugin';
import type { IScenarioContext } from '../../content/contracts/IScenarioContext';
import { SessionRuntime } from './SessionRuntime';

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

    public load(_context: IScenarioContext, _options: IScenarioLoadOptions): void { }
    public unload(_context: IScenarioContext): void { }
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

describe('SessionRuntime object module indexing', () => {
    it('uses plugin metadata for object-module lookup without extra scenario construction', () => {
        const app = new AppContext();
        const { plugin, getCreateCalls } = createPlugin({ exposeMetadata: true });

        const session = new SessionRuntime(app, [plugin], plugin.id);

        expect(getCreateCalls()).toBe(1);
        expect(session.getObjectModuleDefinition('test-object-module')).toBeTruthy();
        expect(getCreateCalls()).toBe(1);
    });

    it('falls back to a one-time scenario instantiation when plugin metadata is absent', () => {
        const app = new AppContext();
        const { plugin, getCreateCalls } = createPlugin({ exposeMetadata: false });

        const session = new SessionRuntime(app, [plugin], plugin.id);

        expect(getCreateCalls()).toBe(2);
        expect(session.getObjectModuleDefinition('test-object-module')).toBeTruthy();
        expect(getCreateCalls()).toBe(2);
    });
});
