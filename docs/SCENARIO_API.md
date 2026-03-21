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

## Headless Rule

Dedicated sessions run the same scenario logic without a render scene.

That means:

- gameplay physics must not depend on rendering availability
- static colliders, trigger volumes, and shared object spawning must still happen when `context.scene.getRoot()` is `null`
- only meshes, local visual decoration, and view-facing UI should be gated on `context.scene.isRenderingAvailable()`

Good pattern:

- always run gameplay setup first
- branch only the visual setup

Example shape:

```ts
public load(context: IScenarioContext): void {
    this.setupGameplay(context);

    if (context.scene.isRenderingAvailable()) {
        this.setupVisuals(context);
    }
}
```

Avoid patterns like:

- early-returning from `load(...)` because there is no scene
- wrapping `createStaticBox(...)` or trigger creation inside a render-only branch

If a dedicated server is authoritative, missing headless physics will cause props to behave correctly while locally owned and then drift or fall through visible geometry when authority returns to the server.

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

## Future Tightening

The cleanest way to make the headless-safe pattern enforceable is a later API split between:

- gameplay/world setup hooks that always run
- visual setup hooks that run only when rendering is available

Today this is a documented authoring rule. If more scenarios start to mix world physics and visuals, that split would be the right next API cleanup.

## Useful References

- [GAMEPLAY_API.md](./GAMEPLAY_API.md)
- [REPLICATION.md](./REPLICATION.md)
- [DefaultHangoutScenario.ts](../src/content/scenarios/defaultHangout/DefaultHangoutScenario.ts)
- [TargetTossScenario.ts](../src/content/scenarios/targetToss/TargetTossScenario.ts)
