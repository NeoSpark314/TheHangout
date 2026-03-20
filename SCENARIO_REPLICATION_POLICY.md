# Scenario Replication Reference

This document is the narrow reference for scenario-scoped replication.
For general scenario creation guidance, start with [SCENARIO_AUTHORING_GUIDE.md](SCENARIO_AUTHORING_GUIDE.md).

## Purpose

Scenario replication exists so scenario-owned shared state can stay inside the active scenario instead of being forced into a dedicated replicated object.

Use it for:

- scoreboards
- turn and round state
- puzzle state
- temporary minigame state that should disappear on scenario switch

Do not use it for:

- continuous transform sync
- high-frequency physics state
- state that clearly belongs to one spawned world object

## Where It Lives

- Scenario contract: [src/content/contracts/IReplicatedScenarioModule.ts](src/content/contracts/IReplicatedScenarioModule.ts)
- Scenario-to-feature bridge: [src/content/runtime/ScenarioReplicationChannel.ts](src/content/runtime/ScenarioReplicationChannel.ts)
- Active-scenario host: [src/content/runtime/ScenarioReplicationHost.ts](src/content/runtime/ScenarioReplicationHost.ts)
- Session integration: [src/world/session/SessionRuntime.ts](src/world/session/SessionRuntime.ts)
- Transport-level replication: [src/network/replication/FeatureReplicationService.ts](src/network/replication/FeatureReplicationService.ts)

## Contract

`IReplicatedScenarioModule` extends `IScenarioModule` with:

- `replicationKey: string`
- `replicationPolicy?: IScenarioReplicationPolicy`
- `onScenarioReplicationEvent(eventType, data, meta)`
- `captureScenarioReplicationSnapshot?()`
- `applyScenarioReplicationSnapshot?(snapshot)`

Convenience helper injected by `SessionRuntime` onto the live scenario instance:

- `emitReplicationEvent?(eventType, data, options)`

The injected helper is optional convenience only. The actual contract is the replicated-scenario interface above.

## Policy Surface

`IScenarioReplicationPolicy`:

- `relayIncomingFromPeer?: 'others' | 'none'`
- `includeInSnapshot?: boolean`
- `defaultLocalEcho?: boolean`

Per-emit override:

- `emitReplicationEvent(eventType, data, { localEcho?: boolean })`

## Policy Semantics

- `relayIncomingFromPeer`
  - `others` (default): when the host receives an event from a guest, it relays it to all peers except the sender.
  - `none`: the host processes the event locally but does not fan it out.
- `includeInSnapshot`
  - `true` (default): the scenario contributes snapshot data for late join.
  - `false`: the scenario is omitted from the late-join feature snapshot.
- `defaultLocalEcho`
  - `true` (default): local emit is applied immediately before network send.
  - `false`: local emit skips immediate local application.

## Lifecycle

- Built-in scenario plugins are composed at bootstrap and injected into `SessionRuntime`.
- `SessionRuntime` instantiates the active scenario from the selected plugin.
- If the active scenario implements `IReplicatedScenarioModule`, `SessionRuntime` attaches a scenario replication channel after `load()`.
- On scenario switch, `SessionRuntime` detaches the old scenario replication channel before unload and attaches the new one after load.

## Template

```ts
import type {
    IReplicatedScenarioModule,
    IScenarioReplicationMeta,
    IScenarioReplicationPolicy
} from './src/content/contracts/IReplicatedScenarioModule';

class MyScenario implements IReplicatedScenarioModule {
    public readonly id = 'my-scenario';
    public readonly displayName = 'My Scenario';
    public readonly replicationKey = `scenario:${this.id}`;
    public readonly replicationPolicy: IScenarioReplicationPolicy = {
        relayIncomingFromPeer: 'others',
        includeInSnapshot: true,
        defaultLocalEcho: true
    };

    private counter = 0;

    public load(): void {}
    public unload(): void {}
    public update(): void {}
    public getSpawnPoint(index: number) {
        return {
            position: { x: 0, y: 0.2, z: 0 },
            yaw: 0
        };
    }

    public onScenarioReplicationEvent(eventType: string, data: unknown, _meta: IScenarioReplicationMeta): void {
        if (eventType !== 'set-counter') return;
        const payload = data as { value?: number };
        if (typeof payload.value !== 'number') return;
        this.counter = payload.value;
    }

    public captureScenarioReplicationSnapshot(): unknown {
        return { counter: this.counter };
    }

    public applyScenarioReplicationSnapshot(snapshot: unknown): void {
        const payload = snapshot as { counter?: number };
        if (typeof payload.counter !== 'number') return;
        this.counter = payload.counter;
    }
}
```

## Notes

- Scenario replication reuses the generic feature replication transport.
- No new scenario-specific packet type was added.
- The API is intentionally event/snapshot oriented rather than high-frequency state sync.
- Physics transforms and avatar motion should remain in their dedicated pipelines.
