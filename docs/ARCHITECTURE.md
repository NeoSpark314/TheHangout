# Architecture

This is the current high-level map of The Hangout.

## Runtime Structure

| Domain | Role |
|---|---|
| `app/` | Bootstrap, runtime registry, engine loop, event bus |
| `shared/` | Contracts, serializable types, constants, utilities |
| `network/` | Transport, protocol, continuous state sync, semantic replication |
| `world/` | Session lifecycle, entities, spawning, world systems |
| `render/` | Three.js runtime, views, avatar rendering, effects, debug rendering |
| `physics/` | Rapier runtime and physics authority policy |
| `input/` | Tracking providers and input-to-intent translation |
| `ui/` | Flat UI, VR UI, HUD |
| `media/` | Voice and spatial audio |
| `features/` | Cross-cutting features such as social and remote desktop |
| `assets/` | Asset loading and procedural builders |
| `content/` | Scenarios, object modules, gameplay-facing runtime APIs |
| `server/` | Dedicated/headless session hosting |

## Core Model

- `App.ts` is the composition root.
- `AppContext` is the shared runtime registry and state container.
- `SessionRuntime` owns the active scenario, `ScenarioRuntimeContext`, spawned object instances, and trigger updates.
- `EntityRegistry` owns live world entities.
- `PhysicsRuntime` owns Rapier bodies and queries.
- `PhysicsAuthorityRuntime` owns ownership, handoff, and speculative local authority policy.
- `NetworkRuntime` and `AuthoritativeSessionHost` own transport and host-authoritative rules.

## Multiplayer Model

There are two replication lanes:

- Continuous entity state for avatars and shared physics props.
- Semantic replication for object- and scenario-scoped events plus late-join snapshots.

The physics model is:

- local feel first
- host-authoritative convergence
- late handoff for moving props
- eventual consistency for shared physical world state

## Content Model

Content is built from five supported gameplay blocks:

- Shared props via `context.props.spawnShared(...)`
- Semantic object replication via `BaseReplicatedObjectInstance`
- Trigger zones via `context.triggers.createBox(...)`
- Scenario actions via `context.actions.request(...)`
- Scenario-owned local visuals and static colliders via `ScenarioContext`

Object code should stay on the gameplay-facing object API. Scenario code should stay on `ScenarioContext`. Low-level runtime, physics, and network details are engine-internal.

Important headless rule:

- dedicated/headless sessions still run authoritative gameplay physics
- scenario world physics must not depend on render scene availability
- only visual environment setup should be conditional on `context.scene.isRenderingAvailable()`

## Main Entry Points

- [README.md](../README.md)
- [GAMEPLAY_API.md](./GAMEPLAY_API.md)
- [SCENARIO_API.md](./SCENARIO_API.md)
- [REPLICATION.md](./REPLICATION.md)

## Code Landmarks

- [App.ts](../src/app/App.ts)
- [AppContext.ts](../src/app/AppContext.ts)
- [SessionRuntime.ts](../src/world/session/SessionRuntime.ts)
- [ObjectRuntimeContext.ts](../src/content/runtime/ObjectRuntimeContext.ts)
- [ScenarioRuntimeContext.ts](../src/content/runtime/ScenarioRuntimeContext.ts)
- [PhysicsRuntime.ts](../src/physics/runtime/PhysicsRuntime.ts)
- [PhysicsAuthorityRuntime.ts](../src/physics/runtime/PhysicsAuthorityRuntime.ts)
- [NetworkRuntime.ts](../src/network/transport/NetworkRuntime.ts)
- [AuthoritativeSessionHost.ts](../src/network/transport/AuthoritativeSessionHost.ts)
