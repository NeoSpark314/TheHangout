import { afterEach, describe, expect, it } from 'vitest';
import eventBus from '../../app/events/EventBus';
import { DedicatedSessionTransport } from '../../server/DedicatedSessionTransport';
import { HeadlessSession } from '../../server/HeadlessSession';
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';

class DefaultHangoutHeadlessHarness {
    public readonly transport = new DedicatedSessionTransport();
    public readonly session = new HeadlessSession('test-dedicated-session', this.transport);

    public async initialize(): Promise<void> {
        await this.session.context.runtime.physics.init();
        await this.session.context.runtime.session.init(null);
    }

    public stepFrames(count: number, delta: number = 1 / 60): void {
        for (let i = 0; i < count; i++) {
            this.transport.update(delta);
            this.session.context.runtime.entity.update(delta);
            this.session.context.runtime.physics.step(delta);
            this.session.context.runtime.session.update(delta);
            this.session.context.runtime.skills.mount.update();
        }
    }

    public getCube(entityId: string): PhysicsPropEntity | null {
        return this.session.context.runtime.entity.getEntity(entityId) as PhysicsPropEntity | null;
    }

    public reset(): void {
        eventBus.reset();
    }
}

let activeHarness: DefaultHangoutHeadlessHarness | null = null;

afterEach(() => {
    activeHarness?.reset();
    activeHarness = null;
});

describe.sequential('Default Hangout Headless', () => {
    it('creates authoritative tabletop physics and keeps default cubes on the table', async () => {
        const harness = new DefaultHangoutHeadlessHarness();
        activeHarness = harness;

        await harness.initialize();
        harness.stepFrames(2);

        const tableHit = harness.session.context.runtime.physics.raycast(
            { x: 0, y: 2.0, z: 0 },
            { x: 0, y: -1, z: 0 },
            3.0
        );

        expect(tableHit).toBeTruthy();
        expect(tableHit!.point.y).toBeGreaterThan(0.95);
        expect(tableHit!.point.y).toBeLessThan(1.1);

        harness.stepFrames(240);

        const cube = harness.getCube('default-cube-0');
        expect(cube).toBeTruthy();

        const cubePos = cube!.rigidBody.translation();
        expect(cubePos.y).toBeGreaterThan(1.0);
    });
});


