# Scenario Authoring Guide

This document describes the current scenario-authoring model in The Hangout: what a scenario is, what APIs already exist for building gameplay, and the current recommended patterns.

## Scope

Use this guide when you want to:

- add a new scenario
- build a minigame or social activity
- decide whether logic belongs in the scenario or in a reusable object module
- understand which runtime systems are already available to scenario authors

For scenario replication details, also read [SCENARIO_REPLICATION_POLICY.md](SCENARIO_REPLICATION_POLICY.md).

## Current Model

A scenario has two layers:

- `IScenarioPlugin`: registration and composition metadata
- `IScenarioModule`: the live runtime instance

Relevant files:

- [src/content/contracts/IScenarioPlugin.ts](src/content/contracts/IScenarioPlugin.ts)
- [src/content/contracts/IScenarioModule.ts](src/content/contracts/IScenarioModule.ts)
- [src/world/session/SessionRuntime.ts](src/world/session/SessionRuntime.ts)
- [src/content/runtime/BuiltInScenarioPlugins.ts](src/content/runtime/BuiltInScenarioPlugins.ts)

The important architectural shift is:

- `SessionRuntime` no longer hardcodes live scenario singletons
- built-in scenarios are composed at bootstrap
- the active scenario is instantiated from a plugin factory
- switching scenarios destroys the current scenario and creates a fresh one

## Minimal Scenario Contract

A live scenario must provide:

- `load(context, options)`
- `unload(context)`
- `update(delta)`
- `getSpawnPoint(index)`

Optional scenario hooks:

- `applyConfig(context, config)`
- `getDesktopLayout(index, total)`
- `setHologramVisible(visible)`
- `getObjectModules()`
- `getActionProvider()`
- `onPlayerJoined(playerId)`
- `onPlayerLeft(playerId)`
- `emitReplicationEvent(eventType, data, options)`

The lifecycle is intentionally synchronous and atomic today.

## What SessionRuntime Already Provides

`SessionRuntime` is the main scenario host.

Useful runtime-facing capabilities already exposed there:

- `getActiveScenario()`
- `getAvailableScenarios()`
- `switchScenario(id, options)`
- `spawnObjectInstance(moduleId, config)`
- `spawnObjectModule(moduleId, config)`
- `spawnPortableObjectModule(moduleId, config)`
- `getObjectInstance(instanceId)`
- `getFirstObjectInstanceByModuleId(moduleId)`
- `removeObjectInstance(instanceId)`
- `emitObjectInstanceEvent(instanceId, eventType, data)`
- `emitScenarioEvent(eventType, data)`
- `ensureGroundPhysics()`
- `toggleHologram(visible)`
- `getDesktopLayout(...)`

This is already enough to build scenario-owned game flow and still spawn shared props when needed.

## Scenario Actions

Scenarios can expose structured commands through `IScenarioActionProvider`.

Relevant files:

- [src/content/contracts/IScenarioAction.ts](src/content/contracts/IScenarioAction.ts)
- [src/content/runtime/ScenarioActionRuntime.ts](src/content/runtime/ScenarioActionRuntime.ts)

What actions already support:

- action discovery for UI
- per-action labels and descriptions
- role gating: `guest`, `moderator`, `admin`
- payload validation
- optional replication to guests
- host-authoritative execution

Use scenario actions for things like:

- `reset-game`
- `start-round`
- admin-only debug controls
- mode changes that should be explicit commands

## Scenario Replication

If scenario-owned state should remain inside the scenario, use `IReplicatedScenarioModule`.

Relevant files:

- [src/content/contracts/IReplicatedScenarioModule.ts](src/content/contracts/IReplicatedScenarioModule.ts)
- [src/content/runtime/ScenarioReplicationHost.ts](src/content/runtime/ScenarioReplicationHost.ts)
- [src/content/runtime/ScenarioReplicationChannel.ts](src/content/runtime/ScenarioReplicationChannel.ts)

This already gives you:

- semantic scenario events
- late-join snapshots
- per-scenario replication policy
- local echo control

Good uses:

- scoreboards
- turn state
- puzzle/round state
- temporary minigame state that should vanish on scenario switch

Less good uses:

- continuous transform sync
- high-frequency physics state
- state that clearly belongs to one spawned world object

## Object Modules Inside Scenarios

Scenarios can expose object modules through `getObjectModules()`.

Relevant files:

- [src/content/contracts/IObjectModule.ts](src/content/contracts/IObjectModule.ts)
- [src/content/contracts/IObjectRuntimeContext.ts](src/content/contracts/IObjectRuntimeContext.ts)
- [src/content/contracts/IReplicatedObjectInstance.ts](src/content/contracts/IReplicatedObjectInstance.ts)

An object module already gets a focused authoring context with:

- scene add/remove
- simple static collider creation
- interaction collider registration
- object-local sync events
- local tracking state
- entity lookup
- localized audio hooks
- local mount API
- object spawn/remove API
- physics collision-start callback
- cleanup registration

Use object modules when:

- the thing has a clear world identity
- it should be reusable across scenarios
- it owns its own meshes/colliders/state cleanly
- it benefits from object-scoped replication

Examples:

- throwable balls
- chairs
- drawing surfaces
- reusable instruments
- interactive gadgets

## Recommended Content Boundaries

Current rule of thumb:

- keep one-off game rules and one-off visuals inside the scenario
- promote only reusable props into `content/objects`
- use scenario replication for scenario-owned state
- use object replication for object-owned state

That means a scenario can own:

- environment setup
- scoreboards
- target layouts
- timers and rounds
- local VFX/SFX orchestration
- turn logic

While generic reusable pieces can become objects:

- balls
- buttons
- props
- tools
- mounted devices

`Target Toss` is a good example of this boundary:

- the scoreboard and scoring logic stay inside the scenario
- the throwable ball is a reusable content object

## Runtime Systems Scenario Authors Can Already Reach

Through `AppContext.runtime`, scenarios can already access more than the narrow content contracts expose.

Important subsystems:

- render: [src/render/runtime/RenderRuntime.ts](src/render/runtime/RenderRuntime.ts)
- physics: [src/physics/runtime/PhysicsRuntime.ts](src/physics/runtime/PhysicsRuntime.ts)
- audio: [src/media/audio/AudioRuntime.ts](src/media/audio/AudioRuntime.ts)
- input: [src/input/controllers/InputRuntime.ts](src/input/controllers/InputRuntime.ts)
- tracking: [src/input/providers/TrackingRuntime.ts](src/input/providers/TrackingRuntime.ts)
- entities: [src/world/entities/EntityRegistry.ts](src/world/entities/EntityRegistry.ts)
- notifications: [src/app/notifications/NotificationRuntime.ts](src/app/notifications/NotificationRuntime.ts)
- world transitions: [src/render/effects/WorldTransitionRuntime.ts](src/render/effects/WorldTransitionRuntime.ts)

This means scenarios can already do things like:

- create custom scene visuals and lights
- play spatialized sounds
- inspect local tracking state
- look up player entities
- use lower-level physics helpers when needed
- trigger world-transition behavior during scenario switches

Recommended guideline:

- prefer the content-facing contracts first
- reach into `context.runtime` when the clean wrapper does not exist yet
- if multiple scenarios need the same low-level pattern, consider wrapping it into a cleaner content API

## Current Strengths

The current API surface is already strong enough for:

- social spaces
- simple multiplayer minigames
- scenario-owned scoreboards and round state
- shared physics props
- in-world UI panels
- spatial audio feedback
- VR-first interactions
- per-scenario world styling and lighting

## Current Gaps

The engine can already support more than the authoring API currently packages cleanly.

Areas that are still relatively low-level:

- no dedicated high-level game-state helpers
- no standard timer/round/countdown helpers
- no clean scenario-facing particle/VFX API yet
- no richer content-facing trigger/sensor helper layer
- player roster/presence helpers are still somewhat indirect
- some useful engine features still require reaching through `AppContext.runtime`

These are good candidates for future cleanup, but they are not blockers for building scenarios today.

## Recommended Workflow For A New Scenario

1. Add a plugin manifest and register it in built-ins.
2. Keep the first version scenario-owned unless a piece is clearly reusable.
3. Use `load()` to build the environment and spawn any shared props.
4. Use `update()` for host-authoritative gameplay flow.
5. Use `IReplicatedScenarioModule` for scenario-local shared state.
6. Add scenario actions for explicit commands like reset or admin controls.
7. Only extract reusable object modules once the scenario boundary is clear.

## Files To Study

Good entry points for contributors:

- [src/content/scenarios/defaultHangout/DefaultHangoutScenario.ts](src/content/scenarios/defaultHangout/DefaultHangoutScenario.ts)
- [src/content/scenarios/targetToss/TargetTossScenario.ts](src/content/scenarios/targetToss/TargetTossScenario.ts)
- [src/content/scenarios/targetToss/TargetTossEnvironment.ts](src/content/scenarios/targetToss/TargetTossEnvironment.ts)
- [src/content/objects/ThrowableBallObject.ts](src/content/objects/ThrowableBallObject.ts)
- [src/world/session/SessionRuntime.ts](src/world/session/SessionRuntime.ts)

`DefaultHangoutScenario` shows the baseline social-space pattern.
`TargetTossScenario` shows the current minigame pattern with scenario-owned game state and a reusable shared prop.
