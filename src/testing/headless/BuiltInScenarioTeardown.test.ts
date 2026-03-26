import { afterEach, describe, expect, it } from 'vitest';
import {
    BUILT_IN_NETWORK_TEST_SCENARIOS,
    HeadlessNetworkHarness
} from '../network/HeadlessNetworkHarness';

let activeHarness: HeadlessNetworkHarness | null = null;

afterEach(() => {
    activeHarness?.reset();
    activeHarness = null;
});

describe.sequential('Built-in scenario teardown', () => {
    it('removes simple-racing owned objects when switching to default-hangout', async () => {
        const harness = await HeadlessNetworkHarness.createHostOnly({
            scenarioPlugins: BUILT_IN_NETWORK_TEST_SCENARIOS,
            defaultScenarioId: 'simple-racing'
        });
        activeHarness = harness;

        harness.waitUntil(() => harness.host.context.sessionConfig.activeScenarioId === 'simple-racing');
        harness.host.session.applySessionConfigUpdate({ activeScenarioId: 'default-hangout' });
        harness.waitUntil(() => harness.host.context.sessionConfig.activeScenarioId === 'default-hangout');
        harness.stepFrames(5);

        expectNoScenarioArtifacts(harness, [
            'simple-racing-car-0',
            'simple-racing-car-1',
            'simple-racing-car-2',
            'simple-racing-car-3'
        ]);
    });

    it('removes scenario-owned artifacts across consecutive built-in switches', async () => {
        const harness = await HeadlessNetworkHarness.createHostOnly({
            scenarioPlugins: BUILT_IN_NETWORK_TEST_SCENARIOS,
            defaultScenarioId: 'default-hangout'
        });
        activeHarness = harness;

        harness.waitUntil(() => harness.host.context.sessionConfig.activeScenarioId === 'default-hangout');
        harness.host.session.applySessionConfigUpdate({ activeScenarioId: 'target-toss' });
        harness.waitUntil(() => harness.host.context.sessionConfig.activeScenarioId === 'target-toss');
        harness.stepFrames(5);

        expectNoScenarioArtifacts(harness, [
            'default-drawing-surface',
            'default-pen',
            'default-pew-pew-gun',
            'default-drum-pad-arc',
            'default-chair',
            'default-cube-0',
            'default-cube-1',
            'default-cube-2',
            'default-cube-3',
            'default-cube-4',
            'default-cube-5'
        ]);

        harness.host.session.applySessionConfigUpdate({ activeScenarioId: 'wide-circle' });
        harness.waitUntil(() => harness.host.context.sessionConfig.activeScenarioId === 'wide-circle');
        harness.stepFrames(5);

        expectNoScenarioArtifacts(harness, [
            'target-toss-ball-a',
            'target-toss-ball-b',
            'target-toss-ball-c'
        ]);
    });
});

function expectNoScenarioArtifacts(
    harness: HeadlessNetworkHarness,
    instanceIds: string[]
): void {
    const entityIds = Array.from(harness.host.context.runtime.entity.entities.keys());

    for (const instanceId of instanceIds) {
        expect(harness.host.getObject(instanceId)).toBeFalsy();
        expect(entityIds.some((entityId) => entityId === instanceId || entityId.startsWith(`${instanceId}:`))).toBe(false);
    }
}
