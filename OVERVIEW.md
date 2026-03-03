# Overview of The Hangout

This document is a quick orientation guide for the current codebase after the architecture refactor.
It is meant to help a contributor understand the live project structure, vocabulary, and major runtime boundaries.

## Architecture

The project is organized by domain first, not by generic implementation buckets.
The app is still object-oriented and runtime-driven, but the structure now separates responsibilities more clearly:

| Domain | Role |
|---|---|
| `app/` | Bootstrap, runtime wiring, engine loop, app-wide event bus |
| `shared/` | Contracts, serializable types, constants, generic utilities |
| `network/` | Transport, packet protocol, state sync, feature replication |
| `world/` | Session state, entity lifecycle, spawning, world systems |
| `render/` | Three.js scene/runtime, entity views, avatar rendering, effects |
| `physics/` | Rapier simulation runtime and physics-facing systems |
| `input/` | Tracking providers and device-to-intent translation |
| `ui/` | Flat pre-session UI, VR UI, HUD |
| `media/` | Voice and audio playback/runtime integrations |
| `features/` | Cross-cutting gameplay/runtime features such as social and remote desktop |
| `assets/` | Procedural world builders and asset runtime helpers |
| `content/` | Content authoring layer for scenarios and self-contained object modules |
| `server/` | Headless session and server-side network runtime |

## Core Principles

1. **Single composition root**: [App.ts](/c:/programming/TheHangout/src/app/App.ts) owns runtime assembly. Subsystems are registered in one place through `AppContext`.
2. **Role-based naming**: `Runtime`, `System`, `Service`, `Registry`, `Provider`, and `Feature` are used intentionally. `Manager` is no longer the default catch-all.
3. **Domain-first structure**: top-level folders describe product areas (`network`, `world`, `render`), while subfolders describe roles inside those areas.
4. **Explicit runtime registry**: global subsystem access is exposed through `context.runtime`, not `context.managers`.
5. **World-role-first entities**: entity names describe what they are in the world, not who controls them. Local vs remote behavior is handled via runtime state and strategies.
6. **Typed network contracts**: packets and replicated entity state remain explicitly typed, with compact payloads for avatar and physics sync.
7. **Input abstraction**: gameplay consumes spatial state and intent, not raw device-specific APIs.
8. **Feature isolation**: cross-cutting capabilities such as social interactions and remote desktop stay separate from app-wide infrastructure.
9. **Content-first extensibility**: scenarios and experimental objects now have a content-facing layer that sits above low-level engine spawning.
10. **Entity vs content separation**: low-level replicated world primitives can stay in `world/entities`, while scenarios expose content-facing object modules that spawn and configure them.

## Runtime Model

### App and Engine

- [App.ts](/c:/programming/TheHangout/src/app/App.ts) boots the app in a fixed order: infrastructure, world initialization, then engine startup.
- [Engine.ts](/c:/programming/TheHangout/src/app/Engine.ts) runs the frame loop over registered systems.
- [AppContext.ts](/c:/programming/TheHangout/src/app/AppContext.ts) is the shared runtime state container and dependency registry.

### Entities and Spawning

- [EntityRegistry.ts](/c:/programming/TheHangout/src/world/entities/EntityRegistry.ts) stores and updates active entities.
- [EntityFactory.ts](/c:/programming/TheHangout/src/world/spawning/EntityFactory.ts) is the low-level engine spawn registry for core world entities.
- The current player model is unified around [PlayerAvatarEntity.ts](/c:/programming/TheHangout/src/world/entities/PlayerAvatarEntity.ts).
- Local vs remote avatar behavior is delegated to strategy classes under [src/world/entities/strategies](/c:/programming/TheHangout/src/world/entities/strategies).
- Core entity types such as [PenToolEntity.ts](/c:/programming/TheHangout/src/world/entities/PenToolEntity.ts) still live here when they are engine-facing replicated primitives.

### Content, Scenarios, and Object Modules

- [IScenarioModule.ts](/c:/programming/TheHangout/src/content/contracts/IScenarioModule.ts) defines a loadable world package.
- [IObjectModule.ts](/c:/programming/TheHangout/src/content/contracts/IObjectModule.ts) defines a self-contained spawnable content object.
- [ISpawnedObjectInstance.ts](/c:/programming/TheHangout/src/content/contracts/ISpawnedObjectInstance.ts) is the runtime lifecycle contract for spawned content instances.
- [IReplicatedObjectInstance.ts](/c:/programming/TheHangout/src/content/contracts/IReplicatedObjectInstance.ts) adds per-instance sync hooks for content objects that need networked events and late-join snapshots.
- [ScenarioRegistry.ts](/c:/programming/TheHangout/src/content/runtime/ScenarioRegistry.ts) tracks available scenarios.
- [ObjectModuleRegistry.ts](/c:/programming/TheHangout/src/content/runtime/ObjectModuleRegistry.ts) tracks the object modules exposed by the active scenario.
- [ObjectInstanceRegistry.ts](/c:/programming/TheHangout/src/content/runtime/ObjectInstanceRegistry.ts) tracks active spawned content instances and destroys them on scenario unload.
- [ObjectReplicationHost.ts](/c:/programming/TheHangout/src/content/runtime/ObjectReplicationHost.ts) adapts replicated object instances onto the existing feature replication transport.
- [DefaultHangoutScenario.ts](/c:/programming/TheHangout/src/content/scenarios/defaultHangout/DefaultHangoutScenario.ts) is now the baseline meeting-room scenario.
- Small experimental content can now be authored as compact object modules, such as [DebugBeaconObject.ts](/c:/programming/TheHangout/src/content/objects/DebugBeaconObject.ts).
- Content modules can also wrap low-level engine entities. For example, [PenToolObject.ts](/c:/programming/TheHangout/src/content/objects/PenToolObject.ts) is the content-facing module, while [PenToolEntity.ts](/c:/programming/TheHangout/src/world/entities/PenToolEntity.ts) remains the low-level replicated primitive it spawns.
- Shared drawing is now content-owned: [DrawingSurfaceObject.ts](/c:/programming/TheHangout/src/content/objects/DrawingSurfaceObject.ts) is a replicated object instance that owns stroke state and late-join snapshots.

### Networking

- [NetworkRuntime.ts](/c:/programming/TheHangout/src/network/transport/NetworkRuntime.ts) owns the client transport layer.
- [StateSynchronizer.ts](/c:/programming/TheHangout/src/network/replication/StateSynchronizer.ts) handles continuous authoritative state sync.
- [FeatureReplicationService.ts](/c:/programming/TheHangout/src/network/replication/FeatureReplicationService.ts) handles semantic feature events and snapshots.
- Replicated content objects now reuse that transport through per-instance replication keys (`object:<moduleId>:<instanceId>`) instead of requiring a new hardcoded engine feature per object type.
- Player tokens are unified under `EntityType.PLAYER_AVATAR`; local vs remote avatar mode is runtime state (`controlMode`), not a separate entity type.

### Session and Spawn Rules

- [SessionRuntime.ts](/c:/programming/TheHangout/src/world/session/SessionRuntime.ts) now acts as the scenario host for the active session.
- [PlayerPresenceService.ts](/c:/programming/TheHangout/src/world/session/PlayerPresenceService.ts) creates the local player avatar when the session is ready.
- Guest spawn placement depends on `assignedSpawnIndex` from the host. Guest initialization is intentionally delayed until that host-assigned slot is available.
- Spawn points come from the active scenario, not from a hardcoded global room implementation.
- The active scenario can expose its own object modules, and `SessionRuntime` can spawn them through the content-facing object module registry.
- `SessionRuntime` now tracks spawned object instances, not just entity ids, so scenario unload can destroy content-owned runtime state as well as entity-backed objects.

### Input and Tracking

- Tracking state is owned by providers such as [DesktopTrackingProvider.ts](/c:/programming/TheHangout/src/input/providers/DesktopTrackingProvider.ts) and [XRTrackingProvider.ts](/c:/programming/TheHangout/src/input/providers/XRTrackingProvider.ts).
- [InputRuntime.ts](/c:/programming/TheHangout/src/input/controllers/InputRuntime.ts) translates device state into gameplay-facing intents and interactions.
- Local interaction logic should read tracking state from the tracking runtime, not from duplicated mirrors on entities.

### Rendering and Views

- [RenderRuntime.ts](/c:/programming/TheHangout/src/render/runtime/RenderRuntime.ts) owns scene, camera, WebXR, and frame rendering.
- `render/views/` contains general entity views.
- `render/avatar/` contains avatar-specific rendering code.
- Views are visual implementations only; world logic stays in entities and runtimes.

## Current Project Structure

```text
src/
  app/       # bootstrap, engine, app context, events
  assets/    # procedural builders and asset runtime helpers
  content/   # scenarios, object modules, content runtime, object instance sync
  features/  # cross-cutting gameplay/runtime features
  input/     # controllers and tracking providers
  media/     # voice and audio runtime
  network/   # transport, protocol, replication
  physics/   # physics runtime and systems
  render/    # renderer, views, avatar, effects, debug
  server/    # headless session / server-side runtime
  shared/    # contracts, types, constants, utilities
  skills/    # local avatar interaction skills
  ui/        # flat UI, VR UI, HUD
  world/     # session, entities, spawning, world systems
```

## Naming Conventions

- `*Runtime`: long-lived domain subsystem
- `*System`: frame-updated logic unit
- `*Service`: domain coordinator without broad engine ownership
- `*Registry`: id/type-backed storage
- `*Provider`: pluggable implementation behind a contract
- `*Feature`: self-contained gameplay capability
- `*Scenario`: loadable world/experience package
- `*Object`: content-facing self-contained spawnable module
- `*Instance`: runtime object instance owned by a scenario/session
- `*View`: visual-only rendering layer

These names are part of the architecture. New modules should follow them instead of reintroducing generic `Manager` naming.

## Contributor Rule Of Thumb

- If something is a low-level replicated world primitive used by core engine systems, it likely belongs in `world/entities`.
- If something is how a scenario exposes or configures that primitive, it belongs in `content/objects`.
- If something is a spawned content object with its own lifecycle, it should be modeled as an object instance, not just a free-floating entity id.
- If something needs semantic sync and late-join restoration, prefer `IReplicatedObjectInstance` over adding a new hardcoded global feature.

## What To Read Next

- [ARCHITECTURE_REFACTOR_SPEC.md](/c:/programming/TheHangout/ARCHITECTURE_REFACTOR_SPEC.md) for the naming and structure rules that drove the refactor
- [ENTITY_ARCHITECTURE_PLAN.md](/c:/programming/TheHangout/ENTITY_ARCHITECTURE_PLAN.md) for the entity model rationale
- [PLAYER_AVATAR_REFACTOR_PLAN.md](/c:/programming/TheHangout/PLAYER_AVATAR_REFACTOR_PLAN.md) for the unified player-avatar design
