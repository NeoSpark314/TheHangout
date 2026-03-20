# Object Authoring Guide

This document describes the current object-authoring model in The Hangout: what an object module is, what runtime APIs object authors already have, and the current recommended patterns for building reusable and interesting world objects.

## Scope

Use this guide when you want to:

- add a new reusable content object
- decide whether something should stay inside a scenario or become an object module
- understand the current object replication and lifecycle model
- build more polished world props, devices, instruments, seats, tools, or gadgets

For object replication details, also read [OBJECT_REPLICATION_POLICY.md](OBJECT_REPLICATION_POLICY.md).

## Design Principle

The Hangout prioritizes local interaction feel first, while still requiring replication strong enough to preserve a solid shared-world illusion.

For object design, that means:

- the acting player should usually see and hear the result immediately
- friendly social objects do not need strict host-authoritative gating by default
- replication should preserve visible outcomes, stable state, and believable shared causality
- semantic events are often better than trying to synchronize every transient detail

This is especially important for VR objects like throwables, tools, musical objects, and playful gadgets: they should feel good in the hand first, while still reading as part of one connected world.
## Current Model

An object module is the content-facing unit for reusable world objects.

Relevant files:

- [src/content/contracts/IObjectModule.ts](src/content/contracts/IObjectModule.ts)
- [src/content/contracts/ISpawnedObjectInstance.ts](src/content/contracts/ISpawnedObjectInstance.ts)
- [src/content/contracts/IReplicatedObjectInstance.ts](src/content/contracts/IReplicatedObjectInstance.ts)
- [src/content/contracts/IObjectRuntimeContext.ts](src/content/contracts/IObjectRuntimeContext.ts)

At runtime, an object module either:

- returns a low-level engine entity directly, or
- returns a spawned object instance with its own lifecycle

That means the object layer already supports both:

- thin wrappers around existing engine primitives
- fully self-contained replicated objects with their own visuals, state, and interactions

## Minimal Object Contract

An object module provides:

- `id`
- `displayName`
- optional `tags`
- optional `networked`
- optional `portable`
- `spawn(context, config)`

`spawn(...)` can return:

- a low-level entity
- a spawned object instance
- `null`

Spawn config already supports:

- ids
- position
- rotation
- owner id
- size
- color
- url
- half extents
- scale
- optional sphere-physics overrides

## Runtime Context Available To Objects

The current object-facing authoring surface is [IObjectRuntimeContext.ts](src/content/contracts/IObjectRuntimeContext.ts).

Object authors already get:

- `scene.add/remove(...)`
- static cuboid collider creation
- interaction collider registration/unregistration
- rigid body removal
- localized audio helpers
- entity lookup
- local tracking state and local player lookup
- object-local replication emit
- local mount API
- object spawn/get/remove API
- collision-start subscription
- cleanup registration

This is already enough for a wide range of object types.

## Base Classes

Most authored objects should start from one of these:

- [src/content/runtime/BaseObjectInstance.ts](src/content/runtime/BaseObjectInstance.ts)
- [src/content/runtime/BaseReplicatedObjectInstance.ts](src/content/runtime/BaseReplicatedObjectInstance.ts)

`BaseObjectInstance` gives you:

- `ownSceneObject(...)`
- `ownPhysicsBody(...)`
- `addCleanup(...)`
- standard `destroy()` cleanup for scene objects, materials, geometry, physics bodies, and registered callbacks

`BaseReplicatedObjectInstance` adds:

- standard replication key pattern: `object:<moduleId>:<instanceId>`
- default object replication policy
- `emitSyncEvent(...)`
- abstract replication event hook
- optional snapshot hooks

Recommended rule:

- if the object has local-only or purely visual state, start with `BaseObjectInstance`
- if the object has semantic shared state, start with `BaseReplicatedObjectInstance`

## Object Replication

Replicated objects use:

- [src/content/contracts/IReplicatedObjectInstance.ts](src/content/contracts/IReplicatedObjectInstance.ts)
- [src/content/runtime/ObjectReplicationHost.ts](src/content/runtime/ObjectReplicationHost.ts)

That already gives objects:

- semantic object-local events
- late-join snapshots
- per-object replication policy
- local echo control

Good uses:

- drawing surfaces
- mount occupancy state
- sequencer or instrument state
- toggles and device modes
- reusable game gadgets with local world identity

## Common Object Styles In The Current Codebase

The existing objects already show several useful patterns.

### 1. Thin wrapper around an engine primitive

Example:

- [src/content/objects/ThrowableBallObject.ts](src/content/objects/ThrowableBallObject.ts)

Use this when:

- the underlying engine entity path already exists
- the object is mostly configuration and appearance
- you want a clean reusable content-facing spawn module

### 2. Self-contained replicated visual object

Example:

- [src/content/objects/DrawingSurfaceObject.ts](src/content/objects/DrawingSurfaceObject.ts)

Use this when:

- the object owns its own visuals and state
- semantic replication is enough
- late join should reconstruct the object from a snapshot

### 3. Interactive replicated object with world behavior

Examples:

- [src/content/objects/ChairObject.ts](src/content/objects/ChairObject.ts)
- [src/content/objects/DrumPadArcObject.ts](src/content/objects/DrumPadArcObject.ts)

Use this when:

- the object has multiple interactive parts
- it needs world visuals, colliders, local behavior, and shared state
- it should feel like a real reusable prop or station inside scenarios

## Mounting Pattern

For mountable or seat-like objects, the current helper is:

- [src/content/runtime/AuthoritativeSingleMountReplicator.ts](src/content/runtime/AuthoritativeSingleMountReplicator.ts)

This already solves a lot of complexity around:

- mount requests and release requests
- local optimistic mount behavior
- authoritative occupancy state
- mount rejection
- local mount/unmount integration

If you are building:

- chairs
- seats
- stools
- turret-like mounted devices
- fixed kiosks

then this helper is the first thing to look at.

## What Makes A Nice Object In The Current System

The current runtime is already capable of fairly nice objects if they combine a few ingredients well:

- clear world identity
- self-contained visuals
- localized audio feedback
- direct hand interaction or trigger interaction
- clean shared semantic state where needed
- sensible cleanup and ownership

A polished object today can already have:

- custom meshes and materials
- interaction colliders
- collision-driven behavior
- replicated toggles/state
- late-join state restoration
- mount behavior
- spatial sound
- helper sub-objects or spawned companion objects

## Recommended Content Boundary

Current rule of thumb:

- keep one-off game-specific logic inside the scenario
- extract reusable world things into `content/objects`

Good candidates for object modules:

- balls
- chairs
- drawing boards
- instruments
- control panels
- arcade gadgets
- tools
- portable props

Bad candidates for object modules:

- one-off scoreboard logic for a single minigame
- highly scenario-specific round state
- a visual element that only makes sense in one scenario and has no independent world identity

A useful question is:

- does this feel like a reusable thing in the world?

If yes, it probably belongs in `content/objects`.

## Recommended Workflow For A New Object

1. Start with `IObjectModule` and decide whether the result should be an entity wrapper or a spawned instance.
2. If the object owns state or cleanup, use `BaseObjectInstance` or `BaseReplicatedObjectInstance`.
3. Build the visuals first and make ownership of meshes explicit through `ownSceneObject(...)`.
4. Add the minimum collider/interactable surface needed.
5. Add localized audio if the object should feel responsive.
6. Add replication only for semantic state that really must be shared.
7. Add snapshot support if late-join should reconstruct the object.
8. Extract helper classes only after the object’s shape is clear.

## Current Strengths

The current object system is already strong enough for:

- reusable props
- portable objects
- instruments and musical toys
- seats and mountable devices
- replicated semantic gadgets
- custom visual stations
- objects that coordinate colliders, input, sound, and state in one place

## Current Gaps

A few object-authoring areas are still relatively low-level:

- the clean physics authoring surface is still narrow
- there is no small library of common visual widgets/helpers yet
- interaction patterns are not fully standardized into reusable helpers
- some richer effects still require reaching deeper into engine/runtime code

So object authoring is already capable, but not fully ergonomic yet.

## Files To Study

Good examples to learn from:

- [src/content/objects/ThrowableBallObject.ts](src/content/objects/ThrowableBallObject.ts)
- [src/content/objects/ChairObject.ts](src/content/objects/ChairObject.ts)
- [src/content/objects/DrawingSurfaceObject.ts](src/content/objects/DrawingSurfaceObject.ts)
- [src/content/objects/DrumPadArcObject.ts](src/content/objects/DrumPadArcObject.ts)
- [src/content/runtime/BaseObjectInstance.ts](src/content/runtime/BaseObjectInstance.ts)
- [src/content/runtime/BaseReplicatedObjectInstance.ts](src/content/runtime/BaseReplicatedObjectInstance.ts)
- [src/content/runtime/ObjectRuntimeContext.ts](src/content/runtime/ObjectRuntimeContext.ts)
- [src/content/runtime/AuthoritativeSingleMountReplicator.ts](src/content/runtime/AuthoritativeSingleMountReplicator.ts)

These give a good spread from simple wrapper objects to complex replicated interactive stations.

## Relationship To Scenario Authoring

This guide complements [SCENARIO_AUTHORING_GUIDE.md](SCENARIO_AUTHORING_GUIDE.md).

A useful split is:

- scenarios own one-off game flow, environment, score state, and scenario-specific visuals
- objects own reusable world things with clear identity and reuse value

That distinction is already working well in the current codebase and is worth preserving.

