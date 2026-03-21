# Replication

This is the current replication model.

## Two Replication Lanes

### 1. Continuous entity state

Use this for:

- player avatars
- shared physics props

This lane is authoritative continuous state sync, not semantic event replay.

Key files:

- [StateSynchronizer.ts](../src/network/replication/StateSynchronizer.ts)
- [NetworkRuntime.ts](../src/network/transport/NetworkRuntime.ts)
- [AuthoritativeSessionHost.ts](../src/network/transport/AuthoritativeSessionHost.ts)

### 2. Semantic feature replication

Use this for:

- object events
- object late-join snapshots
- scenario events
- scenario late-join snapshots

Key files:

- [FeatureReplicationService.ts](../src/network/replication/FeatureReplicationService.ts)
- [ObjectReplicationHost.ts](../src/content/runtime/ObjectReplicationHost.ts)
- [ScenarioReplicationHost.ts](../src/content/runtime/ScenarioReplicationHost.ts)

## Object Replication

Replicated objects use:

- `BaseReplicatedObjectInstance`
- `emitSyncEvent(...)`
- `captureReplicationSnapshot()`
- `applyReplicationSnapshot(...)`

Use object replication for semantic state that belongs to one spawned object:

- URL/content state
- toggles and modes
- drawing strokes
- instrument control state
- occupancy or device state

Do not use it for high-frequency rigid-body motion.

## Scenario Replication

Replicated scenarios use:

- `IReplicatedScenarioModule`
- scenario semantic events
- scenario late-join snapshots

Use it for scenario-owned shared state:

- scoreboards
- rounds
- puzzle state
- temporary minigame state

## Object Replication Policy

Objects can control semantic replication behavior with:

- `relayIncomingFromPeer`
- `includeInSnapshot`
- `defaultLocalEcho`

Per-event `localEcho` overrides are available on `emitSyncEvent(...)`.

Keep object-specific event names, validation, and authority rules inside the object itself.

## Current Physics Replication Model

Physics props use:

- local-feel authority acquisition
- host-authoritative convergence
- delayed release/handoff for moving props
- semantic object replication only for non-physics state

Key files:

- [PhysicsRuntime.ts](../src/physics/runtime/PhysicsRuntime.ts)
- [PhysicsAuthorityRuntime.ts](../src/physics/runtime/PhysicsAuthorityRuntime.ts)
- [PhysicsPropEntity.ts](../src/world/entities/PhysicsPropEntity.ts)

## Rule Of Thumb

- Motion and ownership: physics/entity sync
- Stable meaning and late-join restoration: semantic object/scenario replication
