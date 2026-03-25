import { describe, expect, it } from 'vitest';
import { HeadlessSession } from '../../server/HeadlessSession';
import { DedicatedSessionTransport } from '../../server/DedicatedSessionTransport';
import { BUILT_IN_SCENARIO_PLUGINS } from '../../content/runtime/BuiltInScenarioPlugins';

describe.concurrent('Scenario Smoke Tests', () => {
    for (const plugin of BUILT_IN_SCENARIO_PLUGINS) {
        it(`boots actual headless server safely for scenario: ${plugin.id}`, async () => {
            const transport = new DedicatedSessionTransport();
            const session = new HeadlessSession(`smoke-${plugin.id}`, transport);
            
            // Override the default scenario before starting
            session.context.sessionConfig.activeScenarioId = plugin.id;
            
            await session.start();
            
            // Let the engine and scenario initialization loops run naturally for 200ms
            await new Promise(resolve => setTimeout(resolve, 200));
            
            expect(session.engine).toBeDefined();
            
            session.stop();
        });
    }
});
