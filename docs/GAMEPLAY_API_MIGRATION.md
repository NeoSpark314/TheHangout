# Gameplay API Migration

Use this mapping when converting older content modules to the gameplay-first API.

## Old To New

- `context.app.runtime.render` -> `context.scene.isRenderingAvailable()` and `context.scene.add/remove`
- `context.app.runtime.assets.getNormalizedModel(...)` -> `context.assets.getNormalizedModel(...)`
- `context.app.runtime.assets.loadTexture(...)` -> `context.assets.loadTexture(...)`
- `spawnSharedPhysicsProp(...)` -> `context.props.spawnShared(...)`
- `context.app.runtime.physics.applyInteractionImpulse(...)` -> `context.props.applyImpulse(...)`
- `context.app.runtime.physics.raycast(...)` -> `context.props.raycast(...)`
- `context.app.runtime.entity.getEntity(...)` for props -> `context.props.get(...)`
- `context.app.runtime.entity.getEntity(...)` for players -> `context.players.get(...)`
- `context.onPhysicsCollisionStarted(...)` for local zone semantics -> `context.triggers.createBox(...)`
- `context.app.isHost` -> `context.actions.isHost()`
- ad hoc host rule mutation -> `context.actions.request(...)`

## Recommended Patterns

### Shared physics prop

- Use `BaseReplicatedPhysicsPropObjectInstance`
- Spawn the prop through `context.props.spawnShared(...)`
- Keep semantic state in object events and snapshots

### Trigger-driven local logic

- Use `BaseObjectInstance` or `BaseReplicatedObjectInstance`
- Create local trigger zones with `context.triggers.createBox(...)`
- Replicate only the semantic result, not the local detection details

### Semantic replicated object

- Use `BaseReplicatedObjectInstance`
- Emit compact semantic events
- Snapshot durable state for late joiners

## Migration Rules

- Remove direct object access to low-level physics/runtime/network internals.
- Prefer handles and grouped context capabilities over raw engine services.
- Keep multiplayer authority policy inside the engine, not in content objects.
- If a feature is not covered by the gameplay API, add a focused engine-facing helper instead of reaching around the context.
