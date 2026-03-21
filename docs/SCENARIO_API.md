# Scenario API

This is the current scenario authoring model.

## Scenario Shape

A scenario has two layers:

- `IScenarioPlugin`: registration metadata and factory
- `IScenarioModule`: the live runtime instance

`SessionRuntime` instantiates the active scenario and provides it with a `ScenarioContext`.

## Live Scenario Contract

Required:

- `load(context, options)`
- `unload(context)`
- `update(delta)`
- `getSpawnPoint(index)`

Common optional hooks:

- `applyConfig(context, config)`
- `getDesktopLayout(index, total)`
- `setHologramVisible(visible)`
- `getObjectModules()`
- `getActionProvider()`
- `onPlayerJoined(context, playerId)`
- `onPlayerLeft(context, playerId)`

## What Scenarios Should Own

Keep scenario-specific state and flow in the scenario:

- environment setup
- scoreboards
- rounds and timers
- game rules
- target layouts
- scenario-specific VFX/SFX orchestration

Promote only reusable world things into object modules.

## ScenarioContext

Scenarios should work through `ScenarioContext`, not `AppContext`, `SessionRuntime`, or raw runtime registries.

Main groups:

- `scene`
- `assets`
- `audio`
- `players`
- `objects`
- `props`
- `physics`
- `actions`
- `events`
- `timers`
- `random`

Important supported patterns:

- spawn/remove scenario objects through `context.objects`
- build local environment visuals through `context.scene`
- create scenario-owned static colliders through `context.physics.createStaticBox(...)`
- reset shared props through `context.props.reset(...)`
- enumerate and label players through `context.players`
- emit semantic scenario replication through `context.events.emitScenario(...)`

Do not use:

- `AppContext`
- `SessionRuntime`
- `context.runtime.*`
- raw entity scans
- direct physics prop mutation

## Scenario Actions

Use scenario actions for explicit host-authoritative commands:

- start/reset round
- change mode
- admin or moderator controls
- scoreboard-affecting actions

Scenarios expose actions through `IScenarioActionProvider`. Guests request actions; the host validates and executes them.

## Replication Boundary

Use replicated scenarios for semantic scenario-owned state:

- scoreboards
- round state
- puzzle state
- temporary minigame state

Do not use scenario replication for:

- high-frequency transforms
- physics prop motion
- avatar motion
- state that clearly belongs to one spawned object

For those, use the existing entity and object systems.

## Rule Of Thumb

- If it is reusable and has clear world identity, make it an object module.
- If it is one scenario’s rules or temporary shared state, keep it in the scenario.
- If it is local environment setup for one scenario, use `ScenarioContext.scene` and `ScenarioContext.physics`.

## Useful References

- [GAMEPLAY_API.md](./GAMEPLAY_API.md)
- [REPLICATION.md](./REPLICATION.md)
- [DefaultHangoutScenario.ts](../src/content/scenarios/defaultHangout/DefaultHangoutScenario.ts)
- [TargetTossScenario.ts](../src/content/scenarios/targetToss/TargetTossScenario.ts)
