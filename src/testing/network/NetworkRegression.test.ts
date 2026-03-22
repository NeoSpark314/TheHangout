import { afterEach, describe, expect, it } from 'vitest';
import type { PhysicsPropEntity } from '../../world/entities/PhysicsPropEntity';
import { HeadlessNetworkHarness } from './HeadlessNetworkHarness';
import type { PlayerAvatarEntity } from '../../world/entities/PlayerAvatarEntity';

let activeHarness: HeadlessNetworkHarness | null = null;

afterEach(() => {
    activeHarness?.reset();
    activeHarness = null;
});

describe.sequential('Headless Network Regression', () => {
    it('gives the first guest impulse immediate local motion on a settled cube', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;
        const guest = harness.requireGuest();

        harness.spawnHostObject('grabbable-cube', {
            id: 'test-cube',
            position: { x: 0, y: 1.15, z: 0 },
            size: 0.12
        });

        harness.waitUntil(() => !!guest.getPhysicsProp('test-cube'));
        harness.stepFrames(180);

        const guestCube = guest.getPhysicsProp('test-cube') as PhysicsPropEntity;
        const pose = guestCube.rigidBody.translation();

        const applied = guest.context.runtime.physics.applyInteractionImpulse(
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

    it('keeps guest ownership during the early part of a throw', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;
        const guest = harness.requireGuest();

        harness.spawnHostObject('throwable-ball', {
            id: 'throw-ball',
            position: { x: 0, y: 1.15, z: 0 },
            size: 0.16
        });

        harness.waitUntil(() => !!guest.getPhysicsProp('throw-ball'));
        harness.stepFrames(180);

        const guestBall = guest.getPhysicsProp('throw-ball') as PhysicsPropEntity;
        guestBall.onGrab(harness.guestId as string, 'right');
        harness.waitUntil(() => guestBall.ownerId === harness.guestId && guestBall.heldBy === harness.guestId, 90);

        guestBall.onRelease({ x: 0.5, y: 1.1, z: 3.0 });
        harness.stepFrames(16);

        const earlyVelocity = guestBall.rigidBody.linvel();
        const earlySpeed = Math.hypot(earlyVelocity.x, earlyVelocity.y, earlyVelocity.z);

        expect(guestBall.ownerId).toBe(harness.guestId);
        expect(guestBall.isAuthority).toBe(true);
        expect(earlySpeed).toBeGreaterThan(1.0);

        harness.waitUntil(() => harness.host.getPhysicsProp('throw-ball')?.ownerId === harness.guestId, 120);

        const hostBall = harness.host.getPhysicsProp('throw-ball') as PhysicsPropEntity;
        expect(hostBall.ownerId).toBe(harness.guestId);
    });

    it('reclaims guest-owned props on disconnect', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;
        const guest = harness.requireGuest();

        harness.spawnHostObject('grabbable-cube', {
            id: 'disconnect-cube',
            position: { x: 0, y: 1.15, z: 0 },
            size: 0.12
        });

        harness.waitUntil(() => !!guest.getPhysicsProp('disconnect-cube'));
        harness.stepFrames(120);

        const guestCube = guest.getPhysicsProp('disconnect-cube') as PhysicsPropEntity;
        const pose = guestCube.rigidBody.translation();
        guest.context.runtime.physics.applyInteractionImpulse(
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

    it('restores the current host prop state for a late-joining guest', async () => {
        const harness = await HeadlessNetworkHarness.createHostOnly();
        activeHarness = harness;

        harness.spawnHostObject('grabbable-cube', {
            id: 'late-join-cube',
            position: { x: 0, y: 1.15, z: 0 },
            size: 0.12
        });

        const hostCube = harness.host.getPhysicsProp('late-join-cube') as PhysicsPropEntity;
        harness.stepFrames(180);

        const resetApplied = harness.host.session.getActiveScenarioContext().props.reset(
            'late-join-cube',
            {
                position: { x: 0.75, y: 1.1, z: -0.6 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            },
            {
                wakeUp: false,
                forceSync: true
            }
        );

        expect(resetApplied).toBe(true);
        harness.stepFrames(10);

        const lateGuest = await harness.connectGuest('late-guest');
        harness.waitUntil(() => !!lateGuest.getPhysicsProp('late-join-cube'));
        harness.stepFrames(20);

        const currentHostPose = hostCube.rigidBody.translation();
        const guestCube = lateGuest.getPhysicsProp('late-join-cube') as PhysicsPropEntity;
        const guestPose = guestCube.rigidBody.translation();
        const guestToHostDistance = distance3(currentHostPose, guestPose);
        const movedFromSpawnDistance = distance3(guestPose, { x: 0, y: 1.15, z: 0 });

        expect(guestToHostDistance).toBeLessThan(0.25);
        expect(movedFromSpawnDistance).toBeGreaterThan(0.3);
    });

    it('replicates chair occupancy between guest and host', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;
        const guest = harness.requireGuest();

        const hostChair = harness.host.getObject('test-chair') as any;
        const guestChair = guest.getObject('test-chair') as any;

        expect(hostChair).toBeTruthy();
        expect(guestChair).toBeTruthy();

        guestChair.handleInteraction({
            type: 'trigger',
            phase: 'start',
            playerId: harness.guestId,
            hand: 'right',
            value: 1
        });

        harness.waitUntil(() => guest.context.runtime.mount.getLocalMountStatus().state === 'mounted', 60);

        expect(hostChair.mountReplication.getOccupiedBy()).toBe(harness.guestId);
        expect(guestChair.mountReplication.getOccupiedBy()).toBe(harness.guestId);

        guestChair.handleInteraction({
            type: 'trigger',
            phase: 'start',
            playerId: harness.guestId,
            hand: 'right',
            value: 1
        });

        harness.waitUntil(() => guest.context.runtime.mount.getLocalMountStatus().state === 'idle', 60);

        expect(hostChair.mountReplication.getOccupiedBy()).toBeNull();
        expect(guestChair.mountReplication.getOccupiedBy()).toBeNull();
    });

    it('resets shared props through the scenario context helper', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;
        const guest = harness.requireGuest();

        harness.spawnHostObject('grabbable-cube', {
            id: 'scenario-reset-cube',
            position: { x: 0, y: 1.15, z: 0 },
            size: 0.12
        });

        harness.waitUntil(() => !!guest.getPhysicsProp('scenario-reset-cube'));
        harness.stepFrames(180);

        const resetApplied = harness.host.session.getActiveScenarioContext().props.reset(
            'scenario-reset-cube',
            {
                position: { x: 1.1, y: 1.2, z: -0.5 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            },
            {
                wakeUp: false,
                forceSync: true
            }
        );

        expect(resetApplied).toBe(true);

        harness.stepFrames(20);

        const hostCube = harness.host.getPhysicsProp('scenario-reset-cube') as PhysicsPropEntity;
        const syncedGuestCube = guest.getPhysicsProp('scenario-reset-cube') as PhysicsPropEntity;

        expect(distance3(hostCube.rigidBody.translation(), { x: 0, y: 1.15, z: 0 })).toBeGreaterThan(0.3);
        expect(distance3(hostCube.rigidBody.translation(), syncedGuestCube.rigidBody.translation())).toBeLessThan(0.2);

        harness.stepFrames(60);

        expect(distance3(hostCube.rigidBody.translation(), syncedGuestCube.rigidBody.translation())).toBeLessThan(0.2);
    });

    it('replicates avatar vrm config through the player state conf payload', async () => {
        const harness = await HeadlessNetworkHarness.create();
        activeHarness = harness;
        const guest = harness.requireGuest();

        guest.context.avatarConfig = {
            color: '#22ccff',
            renderMode: 'vrm-auto',
            vrmUrl: 'https://cdn.example.com/guest-avatar.vrm',
            playerHeightM: 1.8
        };
        guest.context.localPlayer?.setAvatarConfig(guest.context.avatarConfig);

        harness.stepFrames(20);

        const remoteGuestOnHost = harness.host.context.runtime.entity.getEntity(harness.guestId as string) as PlayerAvatarEntity;
        expect(remoteGuestOnHost).toBeTruthy();
        expect(remoteGuestOnHost.avatarConfigSnapshot.color).toBe('#22ccff');
        expect(remoteGuestOnHost.avatarConfigSnapshot.renderMode).toBe('vrm-auto');
        expect(remoteGuestOnHost.avatarConfigSnapshot.vrmUrl).toBe('https://cdn.example.com/guest-avatar.vrm');
    });
});

function distance3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}









