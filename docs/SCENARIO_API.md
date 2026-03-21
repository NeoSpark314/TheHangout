# Scenario API

This is the current scenario authoring model.

## Scenario Shape

A scenario has two layers:

- `IScenarioPlugin`: registration metadata and factory
- `IScenarioModule`: the live runtime instance

`SessionRuntime` instantiates the active scenario from the selected plugin and owns scenario switching.

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
- `onPlayerJoined(playerId)`
- `onPlayerLeft(playerId)`

## What Scenarios Should Own

Keep scenario-specific state and flow in the scenario:

- environment setup
- scoreboards
- rounds and timers
- game rules
- target layouts
- scenario-specific VFX/SFX orchestration

Promote only reusable world things into object modules.

## Main Runtime Capabilities

Scenarios primarily work through:

- `SessionRuntime`
- scenario object modules
- scenario actions
- replicated scenario events and snapshots when needed

Useful `SessionRuntime` calls:

- `spawnObjectInstance(...)`
- `spawnObjectModule(...)`
- `spawnPortableObjectModule(...)`
- `getObjectInstance(...)`
- `getFirstObjectInstanceByModuleId(...)`
- `removeObjectInstance(...)`
- `emitObjectInstanceEvent(...)`
- `emitScenarioEvent(...)`
- `switchScenario(...)`
- `ensureGroundPhysics()`

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

## Useful References

- [GAMEPLAY_API.md](./GAMEPLAY_API.md)
- [REPLICATION.md](./REPLICATION.md)
- [DefaultHangoutScenario.ts](../src/content/scenarios/defaultHangout/DefaultHangoutScenario.ts)
- [TargetTossScenario.ts](../src/content/scenarios/targetToss/TargetTossScenario.ts)
