import { afterEach, describe, expect, it } from 'vitest';
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import { HeadlessNetworkHarness } from './HeadlessNetworkHarness';

let activeHarness: HeadlessNetworkHarness | null = null;

afterEach(() => {
    activeHarness?.reset();
    activeHarness = null;
});

describe.sequential('Headless Network Regression', () => {
    it('gives the first guest impulse immediate local motion on a settled cube', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;

        harness.spawnHostObject('grabbable-cube', {
            id: 'test-cube',
            position: { x: 0, y: 1.15, z: 0 },
            size: 0.12
        });

        harness.waitUntil(() => !!harness.guest.getPhysicsProp('test-cube'));
        harness.stepFrames(180);

        const guestCube = harness.guest.getPhysicsProp('test-cube') as PhysicsPropEntity;
        const pose = guestCube.rigidBody.translation();

        const applied = harness.guest.context.runtime.physics.applyInteractionImpulse(
            guestCube.id,
            { x: 0, y: 0, z: 3.2 },
            { x: pose.x, y: pose.y, z: pose.z }
        );

        expect(applied).toBe(true);

        harness.stepFrames(4);

        const velocity = guestCube.rigidBody.linvel();
        const speed = Math.hypot(velocity.x, velocity.y, velocity.z);

        expect(guestCube.ownerId).toBe(harness.guestId);
        expect(guestCube.isAuthority).toBe(true);
        expect(guestCube.rigidBody.isSleeping()).toBe(false);
        expect(speed).toBeGreaterThan(1.0);
    });

    it('reclaims guest-owned props on disconnect', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;

        harness.spawnHostObject('grabbable-cube', {
            id: 'disconnect-cube',
            position: { x: 0, y: 1.15, z: 0 },
            size: 0.12
        });

        harness.waitUntil(() => !!harness.guest.getPhysicsProp('disconnect-cube'));
        harness.stepFrames(120);

        const guestCube = harness.guest.getPhysicsProp('disconnect-cube') as PhysicsPropEntity;
        const pose = guestCube.rigidBody.translation();
        harness.guest.context.runtime.physics.applyInteractionImpulse(
            guestCube.id,
            { x: 0, y: 0, z: 2.4 },
            { x: pose.x, y: pose.y, z: pose.z }
        );

        harness.waitUntil(() => harness.host.getPhysicsProp('disconnect-cube')?.ownerId === harness.guestId);
        harness.disconnectGuest();

        const hostCube = harness.host.getPhysicsProp('disconnect-cube') as PhysicsPropEntity;
        expect(hostCube.ownerId).toBeNull();
        expect(hostCube.isAuthority).toBe(true);
        expect(hostCube.heldBy).toBeNull();
    });

    it('replicates chair occupancy between guest and host', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;

        const hostChair = harness.host.getObject('test-chair') as any;
        const guestChair = harness.guest.getObject('test-chair') as any;

        expect(hostChair).toBeTruthy();
        expect(guestChair).toBeTruthy();

        guestChair.handleInteraction({
            type: 'trigger',
            phase: 'start',
            playerId: harness.guestId,
            hand: 'right',
            value: 1
        });

        harness.waitUntil(() => harness.guest.context.runtime.mount.getLocalMountStatus().state === 'mounted', 60);

        expect(hostChair.mountReplication.getOccupiedBy()).toBe(harness.guestId);
        expect(guestChair.mountReplication.getOccupiedBy()).toBe(harness.guestId);

        guestChair.handleInteraction({
            type: 'trigger',
            phase: 'start',
            playerId: harness.guestId,
            hand: 'right',
            value: 1
        });

        harness.waitUntil(() => harness.guest.context.runtime.mount.getLocalMountStatus().state === 'idle', 60);

        expect(hostChair.mountReplication.getOccupiedBy()).toBeNull();
        expect(guestChair.mountReplication.getOccupiedBy()).toBeNull();
    });
});
