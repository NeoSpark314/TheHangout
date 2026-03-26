# Scenario API

This is the current scenario authoring model.

Related docs:

- [ENGINE_PHILOSOPHY.md](./ENGINE_PHILOSOPHY.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [GAMEPLAY_API.md](./GAMEPLAY_API.md)
- [REPLICATION.md](./REPLICATION.md)

## Scenario Shape

A scenario has two layers:

- `IScenarioPlugin`: registration metadata and factory
- `IScenarioModule`: the live runtime instance

`ScenarioManager` instantiates the active scenario and provides it with a `ScenarioContext`.

## Live Scenario Contract

Required:

- `loadWorld(context, options)`
- `unloadWorld(context)`
- `update(delta)`
- `getSpawnPoint(index)`

Common optional hooks:

- `loadVisuals(context, options)`
- `unloadVisuals(context)`
- `applyConfig(context, config)`
- `getFeatureLayout(featureId, index, total)`
- `setHologramVisible(visible)`
- `getObjectModules()`
- `getActionProvider()`
- `onPlayerJoined(context, playerId)`
- `onPlayerLeft(context, playerId)`

Scenario plugin metadata may also expose `objectModules` directly. This is the preferred registration path for network discovery because it lets the session layer index reusable object modules without constructing scenario instances just to inspect them.

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

Scenarios should work through `ScenarioContext`, not `AppContext`, `ScenarioManager`, or raw runtime registries.

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
- define reusable scenario object modules on the plugin metadata when they are needed for remote discovery

Do not use:

- `AppContext`
- `ScenarioManager`
- `context.runtime.*`
- raw entity scans
- direct physics prop mutation

## Headless Rule

Dedicated sessions run the same scenario world lifecycle without a render scene.

That means:

- `loadWorld(...)` must not depend on rendering availability
- static colliders, trigger volumes, and shared object spawning must still happen when `context.scene.getRoot()` is `null`
- `loadVisuals(...)` is the render-only phase for meshes, local visual decoration, scene overrides, and view-facing UI

Lifecycle order:

- `ScenarioManager` runs `loadWorld(...)` first
- it then runs `loadVisuals(...)` only when rendering is available
- on teardown or scenario switch it runs `unloadVisuals(...)` before `unloadWorld(...)`

Example shape:

```ts
public loadWorld(context: IScenarioContext): void {
    this.setupGameplay(context);
}

public loadVisuals(context: IScenarioContext): void {
    this.setupVisuals(context);
}
```

Avoid patterns like:

- touching scene/camera/renderer from `loadWorld(...)`
- early-returning from `loadWorld(...)` because there is no scene
- putting `createStaticBox(...)` or trigger creation in `loadVisuals(...)`

If a dedicated server is authoritative, missing headless physics will cause props to behave correctly while locally owned and then drift or fall through visible geometry when authority returns to the server.

## Scenario Actions

Use scenario actions for explicit host-authoritative commands:

- start/reset round
- change mode
- admin or moderator controls
- scoreboard-affecting actions

Scenarios expose actions through `IScenarioActionProvider`. Guests request actions; the host validates and executes them.

## Mounted Object Poses

The local mount contract supports three distinct pose concepts:

- `getSeatPose()`
  - the mounted player root/origin placement
  - this is the primary seat location used while mounted
- `getBodyYawPose()`
  - the body-facing anchor for seated avatar orientation
  - use this when body yaw should follow a stable mount or vehicle heading
- `getViewPose()`
  - the view/head alignment anchor
  - use this when the mounted forward direction or initial view alignment should differ slightly from the seat root

Head-space mount alignment:

- Mount entry aligns the local player in `head` space once.
- This places the actual headset/view at the mount view anchor regardless of the user's current room-scale offset.
- After mount entry, ongoing mount updates preserve local head movement relative to that aligned baseline.

Rule of thumb:

- move the seat with `getSeatPose()`
- align torso/body yaw with `getBodyYawPose()`
- align initial first-person view with `getViewPose()`

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

## Scenario Object Modules

If a scenario owns reusable world objects:

- define them as `IObjectModule`s
- expose them on the scenario plugin via `objectModules`
- spawn them through `context.objects.spawn(...)`

Per-instance content configuration:

- pass per-object config through `IObjectSpawnConfig`
- use `assetUrl` when the same module should load different models or content assets per instance
- keep high-frequency motion in entity/physics replication and semantic state in object replication

## Rule Of Thumb

- If it is reusable and has clear world identity, make it an object module.
- If it is one scenario's rules or temporary shared state, keep it in the scenario.
- If it is local environment setup for one scenario, use `ScenarioContext.scene` and `ScenarioContext.physics`.

## Useful References

- [GAMEPLAY_API.md](./GAMEPLAY_API.md)
- [REPLICATION.md](./REPLICATION.md)
- [DefaultHangoutScenario.ts](../src/content/scenarios/defaultHangout/DefaultHangoutScenario.ts)
- [TargetTossScenario.ts](../src/content/scenarios/targetToss/TargetTossScenario.ts)
