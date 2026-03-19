# Scenario Replication Policy

This project supports scenario-scoped sync so scenario-owned runtime state can stay inside the active scenario instead of being forced into a dedicated content object.

## Goals

- Keep scenario-specific game state inside the scenario when that state is not worth promoting into a reusable object module.
- Reuse the existing generic feature replication transport instead of adding scenario-specific packet handlers.
- Support semantic events and late-join snapshot restoration for the active scenario.

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

Optional helper injected by `SessionRuntime` onto live scenario instances:

- `emitReplicationEvent?(eventType, data, options)`

This helper is only a convenience wrapper. The authoritative contract is the replicated-scenario interface above.

## Policy Surface

`IScenarioReplicationPolicy`:

- `relayIncomingFromPeer?: 'others' | 'none'`
- `includeInSnapshot?: boolean`
- `defaultLocalEcho?: boolean`

Per-emit override:

- `emitReplicationEvent(eventType, data, { localEcho?: boolean })`

## Semantics

- `relayIncomingFromPeer`
  - `others` (default): when host receives an event from a guest, host relays it to all other peers.
  - `none`: host processes the event locally but does not fan it out.
- `includeInSnapshot`
  - `true` (default): scenario snapshot participates in late-join feature snapshot payload.
  - `false`: scenario is omitted from late-join snapshot fan-out.
- `defaultLocalEcho`
  - `true` (default): local emit is applied immediately before network send.
  - `false`: local emit skips immediate local application.

## Recommended Use

Use scenario replication when:

- the state is tightly coupled to one scenario
- the state should disappear completely on scenario switch
- extracting a dedicated object module would add noise rather than clarity

Examples:

- scoreboard state for a one-off activity scenario
- round/turn state owned by a minigame scenario
- scenario-local trigger or puzzle state

Prefer object replication when:

- the state belongs to a spawned object instance
- the thing being synchronized has a clear object identity in the world
- the same logic should be reusable across scenarios

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

## Design Notes

- Scenario replication reuses the same feature replication transport as content objects.
- No new packet type was added for scenarios.
- The API is intentionally event/snapshot oriented, not high-frequency transform sync.
- Continuous physics and avatar transforms should remain in their specialized pipelines.
