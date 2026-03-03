# The Hangout: Entity Architecture Plan

## Purpose

This document defines the target entity model for The Hangout before any further entity renames or hierarchy changes.
The goal is to separate:

- world role
- interaction capability
- replication/authority behavior
- local-only runtime concerns

The current codebase already has workable entity behavior, but some names mix those concerns and will not scale well as the project grows.

## What The Audit Shows

## Current Shared Contracts

From the current core contracts:

- [IEntity](/c:/programming/TheHangout/src/shared/contracts/IEntity.ts) is the base runtime contract:
  - `id`
  - `type`
  - `isAuthority`
  - `isDestroyed`
  - `update()`
  - `destroy()`
- [INetworkable](/c:/programming/TheHangout/src/shared/contracts/INetworkable.ts) is a capability contract layered on top:
  - `ownerId`
  - `getNetworkState()`
  - `applyNetworkState()`
  - `onAuthorityChanged()`

That split is directionally correct. The main issue is not the interfaces. It is the class naming and how network perspective leaks into role names.

## Current Entity Classes

### `NetworkEntity`

File: [NetworkEntity.ts](/c:/programming/TheHangout/src/world/entities/NetworkEntity.ts)

Current role:

- Base class for replicated entities
- Owns:
  - `id`
  - `type`
  - `isAuthority`
  - `ownerId`
  - ownership request/release helpers
  - shared authority synchronization behavior

Assessment:

- This is not a general world entity.
- It is specifically a replicated / authority-aware entity base.
- The name is too broad. It sounds like “anything related to networking.”

Planned direction:

- Rename to `ReplicatedEntity` in a later pass if it remains as a base class.
- Keep it only if there is real shared behavior across multiple replicated entity types.

### `PlayerEntity`

File: [PlayerEntity.ts](/c:/programming/TheHangout/src/world/entities/PlayerEntity.ts)

Current role:

- Thin shared player-avatar base class
- Adds shared player presentation state:
  - display name
  - head height
  - head pose
  - mic/audio state

Assessment:

- This is not a generic “player” gameplay controller.
- It is a shared avatar-state base for local and remote player representations.
- The current name is too broad for what it actually is.

Planned direction:

- Rename to `PlayerAvatarEntity` in a later pass if the split remains.

### `LocalPlayer`

File: [LocalPlayer.ts](/c:/programming/TheHangout/src/world/entities/LocalPlayer.ts)

Current role:

- Local player avatar plus local control host
- Owns:
  - local XR origin
  - local humanoid tracking state
  - local skill stack
  - local movement/grab/UI update loop
  - local network state emission
  - direct view application

Assessment:

- This class mixes:
  - avatar state
  - local control state
  - input-driven behavior
  - some presentation coupling
- It is not just “the local version” of a player avatar. It is a local player controller embedded in an entity.

Planned direction:

- Short term: rename to `LocalPlayerAvatarEntity` only if we keep the current split.
- Long term: reduce local-only logic inside the entity and move more of it into runtime systems so this can collapse toward a single avatar entity model.

### `RemotePlayer`

File: [RemotePlayer.ts](/c:/programming/TheHangout/src/world/entities/RemotePlayer.ts)

Current role:

- Remote player avatar replica
- Owns:
  - interpolated network target state
  - remote voice attachment
  - timeout/disconnect handling
  - remote view application

Assessment:

- This is a replicated avatar presentation entity.
- It is much closer to a true “remote avatar replica” than to a distinct gameplay role.

Planned direction:

- Short term: rename to `RemotePlayerAvatarEntity` only if the split remains.
- Long term: merge as much as possible into a single player-avatar model with local/remote control strategy handled outside the role name.

### `PhysicsEntity`

File: [PhysicsEntity.ts](/c:/programming/TheHangout/src/world/entities/PhysicsEntity.ts)

Current role:

- Replicated grabbable physics prop
- Owns:
  - rigid body handle
  - authority-aware simulation mode transitions
  - grab/release behavior
  - network snapshot interpolation
  - presentation state export

Assessment:

- This is not just “an entity with physics.”
- It is specifically a networked interactive prop entity backed by a rigid body.

Planned direction:

- Rename candidate: `PhysicsPropEntity` or `RigidPropEntity`
- Preferred name: `PhysicsPropEntity`

Reason:

- It is clearly a world prop.
- It distinguishes this from future entities that “can have physics” but are not props.

### `PenEntity`

File: [PenEntity.ts](/c:/programming/TheHangout/src/world/entities/PenEntity.ts)

Current role:

- Replicated non-physics grabbable drawing tool
- Owns:
  - grab state
  - transform state
  - drawing interaction mode
  - draw segment emission

Assessment:

- This is a concrete tool entity, not a generic object.
- The current name is acceptable, but it would be more future-proof if it expressed tool role.

Planned direction:

- Rename candidate: `PenToolEntity`

### `TabletEntity`

File: [TabletEntity.ts](/c:/programming/TheHangout/src/world/entities/TabletEntity.ts)

Current role:

- Local in-world UI surface
- Grabbable and interactable
- Not network-replicated
- Follows the local player in relative mode

Assessment:

- This is not part of the replicated world model right now.
- It is a UI surface entity, not a peer-synced prop.

Planned direction:

- Keep as a distinct local-only entity concept.
- Rename candidate: `TabletSurfaceEntity` or `UiTabletEntity`
- Preferred name: `TabletSurfaceEntity`

### `EntityRegistry`

File: [EntityRegistry.ts](/c:/programming/TheHangout/src/world/entities/EntityRegistry.ts)

Current role:

- Stores all active entities
- Updates them
- Spawns discovered entities through the factory
- Produces authoritative and full snapshots

Assessment:

- This is a registry plus world entity coordinator.
- The current name is acceptable for phase 2.

### `EntityFactory`

File: [EntityFactory.ts](/c:/programming/TheHangout/src/world/spawning/EntityFactory.ts)

Current role:

- Registers entity creators by type token
- Spawns local/remote players, physics props, and pens

Assessment:

- This is the right extension seam for future mods/plugins.
- It should remain registration-driven and data-driven.

## Core Problems To Fix

## Problem 1: Role Names vs Replication Perspective

Current `EntityType` values in [IEntityState.ts](/c:/programming/TheHangout/src/shared/contracts/IEntityState.ts) include:

- `LOCAL_PLAYER`
- `REMOTE_PLAYER`
- `PHYSICS_PROP`
- `PEN`

This mixes:

- world role (`PHYSICS_PROP`, `PEN`)
- local network perspective (`LOCAL_PLAYER`, `REMOTE_PLAYER`)

That will not scale well.

The same player avatar should not become a different role just because the current machine is or is not controlling it.

## Problem 2: Local Input Logic Lives Inside The Local Player Entity

`LocalPlayer` currently owns:

- skill activation
- movement updates
- tracking sync
- local view application

This makes the entity harder to unify with remote avatars later.

This is not immediately wrong, but it makes “one player avatar entity, many control modes” harder to reach.

## Problem 3: Replication Is Inheritance-Driven

`NetworkEntity` is currently the base for all replicated entities.

That is acceptable for now, but over time:

- some entities will be local-only
- some will be replicated
- some may be replicated only in partial form
- some may become server-owned actors/NPCs

That means replication should stay a capability concern first, and only remain a base-class concern where the shared logic is truly substantial.

## Target Entity Design Principles

## 1. Class Names Must Describe World Role

Entity class names should answer:

- What is this thing in the world?

Not:

- Who controls it?
- Where does its state come from?

Bad primary naming axis:

- local
- remote
- network

Good primary naming axis:

- avatar
- prop
- tool
- surface
- actor

## 2. Replication And Authority Are State/Capability

These belong in:

- replication interfaces
- authority flags
- sync strategies
- runtime controllers

Not in the main role name unless the entire type exists only as a replica abstraction.

## 3. Keep The Inheritance Tree Shallow

Prefer a small, understandable hierarchy:

- base world entity
- optional replicated base
- concrete role-specific entities

Do not build a deep hierarchy of abstract classes unless there is strong shared behavior.

## 4. Capabilities Matter More Than Type Checks

The project already uses:

- `IInteractable`
- `IGrabbable`

That is the right direction.

Future entities should continue to compose behavior through capabilities instead of multiplying hardcoded type branches.

## Proposed Target Model

## Layer 1: Core Role Bases

### `WorldEntity`

Purpose:

- Base for all world entities, replicated or local-only

Owns:

- `id`
- `entityKind`
- `isDestroyed`
- base lifecycle hooks

Future note:

- This does not exist yet.
- We should introduce it before or during the entity cleanup pass.

### `ReplicatedEntity`

Purpose:

- Optional base for entities with shared ownership/authority behavior

Owns:

- `isAuthority`
- `ownerId`
- ownership request/release helpers
- shared authority sync

This is the likely end-state rename of today’s `NetworkEntity`.

## Layer 2: Role Bases

### `PlayerAvatarEntity`

Purpose:

- Base for all player avatar representations

Owns:

- avatar presentation state
- display name
- head pose
- voice/mic indicators

This is the likely end-state rename of today’s `PlayerEntity`.

### `PropEntity`

Purpose:

- Base for world props that are grabbable and/or interactable

Future note:

- This does not exist yet.
- It may be useful later if more props share hover/grab state and common presentation.

### `ToolEntity`

Purpose:

- Base for held tools that affect the world semantically

Future note:

- Introduce only if multiple tool-like entities appear.
- Do not add it prematurely if `PenToolEntity` is the only case.

### `UiSurfaceEntity`

Purpose:

- Base for in-world UI panels or interactive local surfaces

Future note:

- Introduce only if more local UI surfaces appear.

## Layer 3: Concrete Entities

### Recommended Concrete Names

- `LocalPlayer` -> `LocalPlayerAvatarEntity` (short term) or merge into a unified `PlayerAvatarEntity` later
- `RemotePlayer` -> `RemotePlayerAvatarEntity` (short term) or merge into a unified `PlayerAvatarEntity` later
- `PlayerEntity` -> `PlayerAvatarEntity`
- `NetworkEntity` -> `ReplicatedEntity`
- `PhysicsEntity` -> `PhysicsPropEntity`
- `PenEntity` -> `PenToolEntity`
- `TabletEntity` -> `TabletSurfaceEntity`

## Recommended Long-Term Simplification

The best future model is:

- One avatar role class: `PlayerAvatarEntity`
- Separate local/remote control strategies

That would look like:

- `PlayerAvatarEntity`
  - shared avatar state
  - shared view-facing state
- `LocalPlayerController` or input/runtime modules
  - drives the locally controlled avatar
- `RemoteAvatarReplicationController` or replication/runtime path
  - drives remote interpolation and timeout behavior

This is cleaner than keeping “local” and “remote” as top-level role names forever.

## Entity Type / Spawn Type Plan

## Current Problem

`EntityType` currently conflates spawn role and local perspective.

## Recommended Direction

Split the concept into:

- `EntityKind`: stable world role
- optional `ReplicationMode` or spawn hint

### Example Future `EntityKind`

- `PLAYER_AVATAR`
- `PHYSICS_PROP`
- `PEN_TOOL`
- `TABLET_SURFACE`

### Example Separate Replication/Spawn Metadata

- `controlMode: 'local' | 'remote'`
- `authorityMode: 'host' | 'owner' | 'proxy'`

This lets a single `PLAYER_AVATAR` kind represent both the local and remote version.

## Migration Strategy

## Phase A: Planning Only

Do not rename entities yet.

- Freeze this target model.
- Decide whether we are doing:
  - a short-term naming cleanup only
  - or a deeper local/remote avatar unification

## Phase B: Safe Naming Alignment

High-confidence renames without changing behavior:

- `NetworkEntity` -> `ReplicatedEntity`
- `PlayerEntity` -> `PlayerAvatarEntity`
- `PhysicsEntity` -> `PhysicsPropEntity`
- `PenEntity` -> `PenToolEntity`
- `TabletEntity` -> `TabletSurfaceEntity`

For players:

- either:
  - `LocalPlayer` -> `LocalPlayerAvatarEntity`
  - `RemotePlayer` -> `RemotePlayerAvatarEntity`
- or defer those until a unification decision is made

## Phase C: Type Token Cleanup

After class names are stable:

- introduce `EntityKind`
- replace `LOCAL_PLAYER` / `REMOTE_PLAYER` with `PLAYER_AVATAR`
- move local vs remote to configuration or runtime role

This will affect:

- network packets
- factory registration
- remote discovery/spawn logic

So it should be a dedicated pass, not bundled into a simple rename.

## Phase D: Local/Remote Avatar Decomposition

If desired, reduce duplication and improve long-term maintainability:

- move local-only control logic out of the avatar entity
- move remote-only replication timeout behavior out of the avatar entity
- converge toward a single player-avatar role model

This is a behavior refactor and should be done after the naming cleanup, not before.

## Future Plugin/Mod Requirements

The entity model should support:

- registering new entity kinds by identifier
- exposing capabilities through interfaces
- allowing entities to be spawned from metadata/config
- minimizing direct knowledge of concrete classes outside factory/registry code

To support that:

- keep `EntityFactory.register()` as the public extension seam
- move toward stable `EntityKind` identifiers
- avoid hardcoding local-vs-remote-specific branching into the general entity API

## Decision Recommendation

The best practical next step is:

1. Do a safe naming pass for the non-player entities and shared bases.
2. Do not rename `LocalPlayer` / `RemotePlayer` yet.
3. First decide whether you want to keep two player avatar classes or converge toward one.
4. After that decision, do the player-entity rename and `EntityType` cleanup together.

That sequence keeps risk low while still moving toward a future-proof model.

## Proposed Next Rename Manifest (When Ready)

High-confidence now:

- `NetworkEntity` -> `ReplicatedEntity`
- `PlayerEntity` -> `PlayerAvatarEntity`
- `PhysicsEntity` -> `PhysicsPropEntity`
- `PenEntity` -> `PenToolEntity`
- `TabletEntity` -> `TabletSurfaceEntity`

Defer pending design decision:

- `LocalPlayer`
- `RemotePlayer`
- `EntityType.LOCAL_PLAYER`
- `EntityType.REMOTE_PLAYER`

## Standard For The Final Entity Model

An entity name is acceptable only if a new contributor can infer:

- what the object is in the world

without needing to know:

- whether this client owns it
- whether it is local or remote
- how it is replicated

If the name depends on those runtime details, the naming is still not good enough.
