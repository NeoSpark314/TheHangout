# The Hangout: Concrete Scenario Ownership Refactor Plan

## Purpose

This document turns the scenario-ownership direction into a concrete implementation plan.
The goal is to make scenario switching actually unload and replace scenario-owned content,
while preserving reusable world-building helpers so scenarios do not have to reimplement
common visuals and props.

This plan focuses on:

- moving default-room ownership out of `SessionRuntime`
- preserving reusable procedural helpers
- making scenario switching clean for visuals, entities, and physics
- keeping the refactor incremental and testable

## Current Problem Summary

The current code has a scenario host, but the default room is still effectively global.

The main problem areas are:

- `SessionRuntime` still owns long-lived `environment` and `props` instances.
- `DefaultHangoutScenario` and `WideCircleScenario` both call `ensureDefaultWorld()`.
- `EnvironmentBuilder` and `PropBuilder` still act as persistent session-global owners.
- cleanup only removes part of what they create.
- scenario-owned spawned entities are tracked, but default-room entities are not.
- scenario-owned colliders are not tracked and therefore not removed on switch.

As a result, scenario switching currently changes spawn policy, not actual world ownership.

## Target Architecture

## Session Layer

`SessionRuntime` should only own:

- active scenario id / active scenario instance
- scenario registry
- object module registry
- session config integration
- host/client scenario switching flow
- player spawn lookup and scenario transition support

`SessionRuntime` should not directly own:

- default room visual instances
- default room feature instances
- default room prop instances
- scenario-specific colliders

## Scenario Layer

Each scenario should own:

- what world content it creates
- what entities it spawns
- what local features it attaches
- what colliders it creates
- how it cleans those things up
- what object modules it exposes

The baseline room becomes a real content package:

- `DefaultHangoutScenario`
- owns a scenario-local world bundle

## Reusable Helper Layer

Reusable code should remain under `assets/` and related domains, but only as factories/prefabs.

These helpers should:

- create objects
- return references/handles
- avoid hidden global ownership
- avoid long-lived singleton behavior

They should not silently become the owner of the session world.

## Concrete File Targets

## Keep But Repurpose

These files should survive, but their responsibilities should narrow:

- [SessionRuntime.ts](/c:/programming/TheHangout/src/world/session/SessionRuntime.ts)
- [DefaultHangoutScenario.ts](/c:/programming/TheHangout/src/content/scenarios/defaultHangout/DefaultHangoutScenario.ts)
- [WideCircleScenario.ts](/c:/programming/TheHangout/src/content/scenarios/wideCircle/WideCircleScenario.ts)

## New Files To Add

### Scenario-Owned World Bundles

- `src/content/scenarios/defaultHangout/DefaultHangoutWorld.ts`
- `src/content/scenarios/wideCircle/WideCircleWorld.ts` (optional at first; may start as minimal)

These classes will own the actual created content for each scenario.

### Reusable Environment Factories

- `src/assets/procedural/environment/SynthwaveEnvironmentFactory.ts`
- `src/assets/procedural/environment/StarfieldFactory.ts`
- `src/assets/procedural/environment/GroundGridFactory.ts`
- `src/assets/procedural/environment/LightingRigFactory.ts`

These replace the monolithic ownership model in `EnvironmentBuilder`.

### Reusable Prop Prefabs

- `src/assets/procedural/prefabs/TablePrefab.ts`
- `src/assets/procedural/prefabs/HologramPrefab.ts`
- `src/assets/procedural/prefabs/PodestGridPrefab.ts`
- `src/assets/procedural/prefabs/DecorationRingPrefab.ts`
- `src/assets/procedural/prefabs/DrumPadArcPrefab.ts`

These replace the monolithic ownership model in `PropBuilder`.

### Optional Reusable Spawn Helpers

- `src/content/helpers/DefaultPropSpawner.ts`

This can contain helpers for spawning the pen and default cubes without tying them to the old builder.

## Files To Deprecate And Then Remove

These should eventually disappear as owning classes:

- [EnvironmentBuilder.ts](/c:/programming/TheHangout/src/assets/procedural/EnvironmentBuilder.ts)
- [PropBuilder.ts](/c:/programming/TheHangout/src/assets/procedural/PropBuilder.ts)

Important:
They may temporarily remain as wrappers during migration, but the end state should remove their
current session-global ownership role.

## Concrete Responsibility Mapping

## `EnvironmentBuilder` Split

Current responsibilities:

- sky color / fog application
- distant hills
- starfield
- floor
- animated grid
- lighting
- synthwave sun
- per-frame visual animation
- partial cleanup

Target split:

- `SynthwaveEnvironmentFactory`
  - creates a root `THREE.Group`
  - creates hills, stars, floor, grid, lights, sun
  - returns:
    - root group
    - optional update callback for animated parts
    - optional destroy callback

Move out of shared global owner:

- all instance fields currently on `EnvironmentBuilder`

What remains shared:

- the mesh-building logic itself

## `PropBuilder` Split

Current responsibilities:

- table + table collider
- hologram + duck
- podest + static colliders
- decoration ring + static colliders
- drum pads + static colliders
- default pen spawn
- default cube spawn
- drum pad hit logic
- drum pad replication feature hookup
- per-frame animation
- partial cleanup

Target split:

- `TablePrefab`
  - returns mesh group + optional collider handles
- `HologramPrefab`
  - returns hologram mesh + optional duck attachment hook
- `PodestGridPrefab`
  - returns group + collider handles
- `DecorationRingPrefab`
  - returns group + collider handles
- `DrumPadArcPrefab`
  - returns:
    - pad meshes
    - pad metadata
    - collider handles

Scenario-local ownership:

- drum pad replication logic
- event subscriptions
- default prop spawning
- scenario-specific entity tracking

These should move into `DefaultHangoutWorld`.

## Scenario-Owned Tracking Requirements

Each scenario-owned world bundle should explicitly track:

- `sceneObjects: THREE.Object3D[]`
- `entityIds: string[]`
- `physicsHandles: number[]` or runtime-specific collider/body handles
- `cleanupCallbacks: Array<() => void>`

This tracking must be complete enough that `unload()` can:

- remove meshes from the scene
- remove scenario-owned entities from `EntityRegistry`
- remove scenario-owned colliders/bodies from physics
- unsubscribe listeners / feature hooks

This is the key lifecycle boundary the current code is missing.

## Required Physics Runtime Support

To make scenario cleanup correct, physics needs explicit removal support for scenario-owned colliders.

If not already present, add:

- `removeRigidBody(handleOrRef)`
- `removeCollider(handleOrRef)`
- or a single helper for removing tracked static scenario colliders

Without this, scenario switching will leave invisible collision volumes behind.

This is a required supporting change, not optional.

## Implementation Sequence

## Phase 1: Add Scenario-Owned Bundle For Default Room

### Goal

Create a new owner without changing the visible room yet.

### Tasks

1. Add `DefaultHangoutWorld.ts`.
2. Move ownership fields from `PropBuilder`/`EnvironmentBuilder` into `DefaultHangoutWorld`.
3. Give `DefaultHangoutWorld` these methods:
   - `load(context, seed?)`
   - `update(delta)`
   - `unload()`
   - `getSpawnPoint(index)`
4. Keep using current builder logic internally if needed as a temporary bridge.

### Success Criteria

- `DefaultHangoutScenario` owns a `DefaultHangoutWorld` instance.
- `SessionRuntime` no longer directly references `environment` or `props` for the active room path.

## Phase 2: Make `WideCircleScenario` Truly Distinct

### Goal

Prove the scenario system can switch visible content.

### Tasks

1. Stop calling `ensureDefaultWorld()` from `WideCircleScenario`.
2. Give `WideCircleScenario` either:
   - a minimal reusable environment-only world bundle
   - or a very simple scenario-local setup with no table/drums/default props
3. Ensure `WideCircleScenario.unload()` removes everything it created.

### Success Criteria

- Switching from `default-hangout` to `wide-circle` removes table, drum pads, hangout props, and hangout-specific colliders.
- Only the wide-circle scenario content remains.

## Phase 3: Extract Reusable Environment Helpers

### Goal

Preserve reuse while removing hidden global state.

### Tasks

1. Extract mesh creation from `EnvironmentBuilder` into the new `environment/` factory files.
2. Make these helpers return constructed objects and update handles.
3. Rebuild `DefaultHangoutWorld` and `WideCircleScenario` on those helpers.
4. Remove direct dependency on `EnvironmentBuilder` from `SessionRuntime`.

### Success Criteria

- No session-global `EnvironmentBuilder` instance remains.
- Scenarios create their own environment instances.

## Phase 4: Extract Reusable Prop Prefabs

### Goal

Turn default-room content into reusable prefabs plus scenario-local ownership.

### Tasks

1. Extract the table, hologram, podest, decorations, and drum pad arc builders into the `prefabs/` files.
2. Move the default prop spawning logic into `DefaultHangoutWorld` or `DefaultPropSpawner`.
3. Move drum pad hit/replication subscriptions out of `PropBuilder` and into scenario-owned logic.
4. Add complete cleanup of:
   - scene objects
   - default spawned entities
   - drum pad colliders
   - event subscriptions

### Success Criteria

- No session-global `PropBuilder` instance remains.
- `DefaultHangoutScenario` fully owns hangout props and their cleanup.

## Phase 5: Remove Legacy Session-Global World Fields

### Goal

Complete the ownership shift.

### Tasks

1. Remove from `SessionRuntime`:
   - `environment`
   - `props`
   - `ensureDefaultWorld()`
   - `applyConfig()` dependency on global builders
2. Replace any remaining callers with scenario-local APIs.
3. Keep only truly session-wide responsibilities in `SessionRuntime`.

### Success Criteria

- `SessionRuntime` is a scenario host, not a world-content owner.

## Phase 6: Tighten Scenario Transition Semantics

### Goal

Make scenario switching robust and unsurprising.

### Tasks

1. Ensure local player repositioning happens after new scenario load completes.
2. Add optional remote-player reposition strategy if needed later.
3. Add a transition notification / loading hint.
4. Verify late joiners load the correct scenario and spawn positions.

### Success Criteria

- Scenario transitions are visually and spatially coherent for all peers.

## Short-Term Concrete Coding Tasks

These are the exact next coding tasks I recommend doing first:

1. Create `DefaultHangoutWorld.ts`.
2. Move current default-room creation/update/unload responsibilities into it.
3. Update `DefaultHangoutScenario` to own `DefaultHangoutWorld`.
4. Make `WideCircleScenario` stop using `ensureDefaultWorld()`.
5. Add explicit physics cleanup support for scenario-owned colliders.
6. Verify that switching to `wide-circle` removes:
   - table
   - hologram
   - drum pads
   - pen
   - default cubes
   - hangout collision volumes

That is the first meaningful milestone where the scenario architecture becomes real instead of just structural.

## Definition Of Done For This Refactor

This refactor is complete only when:

- switching scenarios visibly changes the world content
- old scenario visuals are removed
- old scenario entities are removed
- old scenario colliders are removed
- the default room is no longer session-global state
- reusable visual/prop helpers remain available for new scenarios

Until then, the scenario system is only partially implemented.
