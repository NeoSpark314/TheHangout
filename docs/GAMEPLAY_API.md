# Gameplay API

This is the official content authoring surface for multiplayer gameplay objects.

Related docs:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [SCENARIO_API.md](./SCENARIO_API.md)
- [REPLICATION.md](./REPLICATION.md)

## Supported Building Blocks

- Shared props: `context.props.spawnShared(...)`
- Semantic object replication: `BaseReplicatedObjectInstance.emitSyncEvent(...)`
- Trigger zones: `context.triggers.createBox(...)`
- Scenario actions: `context.actions.request(...)`

These are the intended gameplay primitives for new content.

## Use This

- Use `context.scene` to add and remove owned visuals.
- Use `context.assets` for model and texture loading.
- Use `context.players` and `context.tracking` for local/remote participant queries.
- Use `context.props` for networked grabbable physics props, prop raycasts, and interaction impulses.
- Use `context.triggers` for local trigger/zone logic.
- Use `BaseReplicatedObjectInstance` snapshots and sync events for semantic state.
- Use `context.actions.request(...)` for host-authoritative rule changes, score changes, and scenario mutations.

## Do Not Use

- Do not reach through `context.app.runtime.*` from object code.
- Do not create raw physics colliders from object code.
- Do not register raw interaction colliders from object code.
- Do not expose network ownership or transport details to content modules.
- Do not create new object-specific replication channels outside object events or scenario actions.

## Shared Props

Use `context.props.spawnShared(...)` for multiplayer physics objects.

Supported shape options:

- `shape: 'box'` with `size` and optional `halfExtents`
- `shape: 'sphere'` with `radius`

Supported gameplay options:

- `profile`
- `ownerId`
- `entityId`
- `scale`
- `dualGrabScalable`
- `interaction.onUse`
- `interaction.onGrab`
- `interaction.onRelease`
- `interaction.getCanonicalGrabOffset`
- `interaction.getPreferredHeldQuaternionSpace`

Runtime handle surface:

- `isAuthority()`
- `getOwnerId()`
- `getHeldBy()`
- `requestControl(...)`
- `releaseControl(...)`
- `getPosition()`
- `getLinearVelocity()`
- `getAngularVelocity()`
- `isSleeping()`
- `setMotion(...)`
- `setPose(...)`
- `setBaseHalfExtents(...)`
- `setUniformScale(...)`
- `syncNow(...)`
- `destroy()`

Authority model:

- Use shared props for continuous motion that should feel local for the controlling peer.
- Acquire temporary control with `requestControl(...)` before driving a prop intentionally.
- Release with `releaseControl(...)` when direct control ends.
- Use `setMotion(...)` for continuous controlled velocity changes.
- Use `setPose(...)` for resets, teleports, or recoveries.
- Keep the motion local and continuous, but replicate the minimum semantic state needed for remote playback.

Per-instance asset/model selection:

- Use `assetUrl` in shared prop or object spawn config when a spawned object needs a specific model or content asset.
- `assetUrl` is the stable replicated field for module-backed prop visuals.

## Triggers

Use `context.triggers.createBox(...)` for local trigger zones.

V1 trigger support:

- Box zones only
- Filters: `player`, `shared-prop`, `any`
- Local enter/exit callbacks with stable participant ids

Trigger zones are local engine constructs. If a trigger should change shared gameplay state, use object sync events or scenario actions from the callback.

## Semantic Replication

Use `BaseReplicatedObjectInstance` for shared semantic state that is not continuous rigid-body motion.

Default pattern:

- emit semantic events with `emitSyncEvent(...)`
- implement `captureReplicationSnapshot()`
- implement `applyReplicationSnapshot(...)`

## Scenario Actions

Use `context.actions.request(...)` for host-authoritative game-rule changes.

Use this for:

- score changes
- round control
- win/lose state
- admin or moderator actions

Do not mutate shared scenario rules directly from guests.

## Spatial Audio

Use `context.audio.createEmitter(...)` for long-lived local spatial sounds.

Recommended split:

- Continuous sounds like engine loops, hum, ambience, or skid should be played locally on every client from replicated gameplay state.
- Discrete sounds like impacts or one-off announcements should be replicated as semantic events, then played locally as one-shots.

Do not try to network actual audio playback streams.

## Particles

Use:

- `context.particles.spawnBurst(...)` for simple one-off bursts
- `context.particles.createEmitter(...)` for persistent local effects like smoke, dust, exhaust, or ambient loops

Recommended split:

- Keep particle simulation and rendering local.
- Replicate only the small semantic or presentation state that drives the effect.
- Do not replicate individual particles.

## Intentionally Excluded From V1

- Mounts are supported through the shared mount contract, but their pose semantics are documented in [SCENARIO_API.md](./SCENARIO_API.md) because they are primarily scenario/world integration points.
- Low-level physics/runtime/network access remains engine-internal.
