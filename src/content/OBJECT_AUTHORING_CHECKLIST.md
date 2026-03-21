# Content Object Authoring Checklist

Use this checklist when adding a new object module under `src/content/objects`.

## 1) Choose the right base

- Use `BaseObjectInstance` for local-only objects.
- Use `BaseReplicatedObjectInstance` for replicated semantic/event objects.
- Use `BaseReplicatedPhysicsPropObjectInstance` for replicated grabbable physics props.
- Shared physics props should go through the shared prop spawn path and choose an explicit replication profile.
- Replication profiles are the supported tuning surface for both network feel and physical body/material defaults. Do not add per-object ad hoc damping/friction constants unless the profile system is being extended deliberately.

## 2) Keep IDs stable

- Prefer `instanceId === primaryEntityId`.
- If you need a custom entity id, pass `config.entityId`.
- Avoid ad-hoc id prefixes in new objects.

## 3) Define module metadata intentionally

- `networked: true` only if the object is expected to exist across peers.
- `portable: true` only if it is safe to expose in portable spawn UIs.
- Pick clear `id`, `displayName`, and `tags`.

## 4) Keep authority and sync object-scoped

- Emit semantic events through `emitSyncEvent(...)`.
- Keep event names local to the object (`'set-url'`, `'toggle'`, etc).
- Validate incoming payloads in `onReplicationEvent(...)`.

## 5) Snapshot for late-joiners

- Implement `captureReplicationSnapshot()` if runtime state matters for new peers.
- Implement `applyReplicationSnapshot(...)` defensively (type checks, defaults).

## 6) Own and clean up runtime resources

- Use base helpers (`ownSceneObject`, `ownPhysicsBody`, `addCleanup`).
- Dispose geometry/material/texture resources you create.
- Remove temporary listeners/timers in `destroy()`.

## 7) Keep object code self-contained

- Prefer `IObjectRuntimeContext` capabilities over broad engine coupling.
- Avoid introducing new global replication channels for object-specific logic.
- Do not rely on UI-layer logic for object correctness.

## 8) Spawn-path expectations

- Scenario-owned objects should spawn through `SessionRuntime` object module APIs.
- Portable UI spawns should use `spawnPortableObjectModule(...)`.
- Non-networked objects should not be reconstructed from remote entity state.

## 9) Validation before merge

- Build: `npm run build`
- Multiplayer sanity test:
  - Spawn object on one peer
  - Verify late-join state
  - Verify grab/release/position sync

## 10) Spawn config typing

- Keep spawn config keys explicit and typed.
- Avoid broad catch-all config shapes for new object APIs.
- If a new key is shared across multiple objects, add it to `IObjectSpawnConfig`.
