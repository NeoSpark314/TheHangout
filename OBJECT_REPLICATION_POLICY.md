# Object Replication Policy

This project supports object-scoped sync policy so content objects can keep replication behavior self-contained.

## Goals

- Keep object gameplay logic, event contracts, authority checks, and snapshot semantics inside the object module.
- Avoid adding engine-specific packet handlers or global feature switches for each new object.
- Reuse one generic object replication pipeline across all content objects.

## Where It Lives

- Object contract: [src/content/contracts/IReplicatedObjectInstance.ts](src/content/contracts/IReplicatedObjectInstance.ts)
- Object runtime base: [src/content/runtime/BaseReplicatedObjectInstance.ts](src/content/runtime/BaseReplicatedObjectInstance.ts)
- Object-to-feature bridge: [src/content/runtime/ObjectReplicationChannel.ts](src/content/runtime/ObjectReplicationChannel.ts)
- Transport-level replication: [src/network/replication/FeatureReplicationService.ts](src/network/replication/FeatureReplicationService.ts)

## Policy Surface

`IObjectReplicationPolicy`:

- `relayIncomingFromPeer?: 'others' | 'none'`
- `includeInSnapshot?: boolean`
- `defaultLocalEcho?: boolean`

Per-emit override:

- `emitSyncEvent(eventType, data, { localEcho?: boolean })`

## Semantics

- `relayIncomingFromPeer`:
  - `others` (default): when host receives an event from a guest, host relays to all other peers.
  - `none`: host processes event locally but does not fan it out.
- `includeInSnapshot`:
  - `true` (default): object snapshot participates in late-join feature snapshot payload.
  - `false`: object is omitted from late-join snapshot fan-out.
- `defaultLocalEcho`:
  - `true` (default): local emit is applied immediately before network send.
  - `false`: local emit skips immediate local application.
- `localEcho` (per-event override):
  - overrides `defaultLocalEcho` for a specific event.
  - useful for request-style events where local pre-apply would be wasted or incorrect.

## Recommended Pattern For New Objects

1. Extend `BaseReplicatedObjectInstance`.
2. Define `replicationPolicy` in the object class.
3. Keep all event names, payload validation, and authority rules in `onReplicationEvent(...)`.
4. Implement `captureReplicationSnapshot/applyReplicationSnapshot` only if late-join restoration is needed.
5. Use `emitSyncEvent(..., { localEcho: false })` for host-routed request events.

### Template

```ts
import type {
    IObjectReplicationMeta,
    IObjectReplicationPolicy
} from '../contracts/IReplicatedObjectInstance';
import { BaseReplicatedObjectInstance } from '../runtime/BaseReplicatedObjectInstance';

type TMySnapshot = { version: 1; enabled: boolean };
type TMyEvent = { enabled: boolean };

class MyObjectInstance extends BaseReplicatedObjectInstance {
    public readonly replicationPolicy: IObjectReplicationPolicy = {
        relayIncomingFromPeer: 'others',
        includeInSnapshot: true,
        defaultLocalEcho: true
    };

    private enabled = false;

    public onReplicationEvent(eventType: string, data: unknown, meta: IObjectReplicationMeta): void {
        if (eventType !== 'set-enabled') return;
        if (meta.local) return;
        const payload = data as TMyEvent;
        if (typeof payload.enabled !== 'boolean') return;
        this.enabled = payload.enabled;
    }

    public captureReplicationSnapshot(): unknown {
        return {
            version: 1,
            enabled: this.enabled
        } satisfies TMySnapshot;
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        const state = snapshot as Partial<TMySnapshot>;
        if (state.version !== 1 || typeof state.enabled !== 'boolean') return;
        this.enabled = state.enabled;
    }

    private requestEnable(enabled: boolean): void {
        if (this.context.app.isHost) {
            this.enabled = enabled;
            this.emitSyncEvent('set-enabled', { enabled }, { localEcho: false });
            return;
        }

        // Host-authoritative request event; skip local immediate apply.
        this.emitSyncEvent('set-enabled', { enabled }, { localEcho: false });
    }
}
```

## Example (Drum Pad Arc)

[src/content/objects/DrumPadArcObject.ts](src/content/objects/DrumPadArcObject.ts) now explicitly declares `replicationPolicy` and uses `localEcho: false` for request/snapshot broadcast events (`station-toggle`, `control-action`, `phrase-request`, `arp-touch-request`, `station-sync`, etc.).

This keeps object-specific sync behavior in the object code, while the engine remains generic.

## Replication Debug Runtime

Runtime includes an opt-in replication debug layer with bounded memory:

- Mode: `off` (default), `stats`, `trace`
- Optional feature filter: only track one `featureId` (for example `object:drum-pad-arc:default-drum-pad-arc`)
- Fixed trace ring buffer (max 512 entries)

Console helpers (browser):

```js
window.__hangoutDebug.setReplicationDebugMode('stats');
window.__hangoutDebug.setReplicationDebugFeatureFilter('object:drum-pad-arc:default-drum-pad-arc');
window.__hangoutDebug.getReplicationDebugStats(20);
window.__hangoutDebug.getReplicationDebugTraces(50);
window.__hangoutDebug.clearReplicationDebug();
```

Tracked counters include:

- `emitted`, `incoming`
- `appliedLocal`, `appliedRemote`
- `droppedSeen`, `droppedMissingFeature`
- `relayed`, `relaySuppressed`
- `localEchoSkipped`
- `snapshotsCaptured`, `snapshotsApplied`, `snapshotsQueued`, `snapshotsPendingApplied`

### Performance Safety

- Default mode is `off`, so hot path instrumentation returns immediately.
- No string formatting, serialization, or trace allocations occur when mode is `off`.
- Trace collection is bounded (`maxTraces = 512`) and only active in `trace` mode.
- Feature filter reduces overhead by tracking only one object/feature when needed.
