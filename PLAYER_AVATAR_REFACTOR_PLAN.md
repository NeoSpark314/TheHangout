# The Hangout: Player Avatar Refactor Plan

## Purpose

This document defines the concrete migration path from:

- `LocalPlayer`
- `RemotePlayer`

to:

- one shared `PlayerAvatarEntity`
- separate local and remote control strategies

The goal is to remove duplicated avatar-role code while keeping:

- local input responsiveness
- remote interpolation quality
- clear ownership and networking boundaries

This is a behavior refactor, not just a rename.

## Decision

The chosen end-state is:

- one world-role class: `PlayerAvatarEntity`
- one local control strategy
- one remote replication strategy

This means:

- local vs remote is no longer a primary entity type distinction
- local vs remote becomes runtime configuration
- the avatar entity owns shared avatar state only

## Current State

## Current Spawn Path

The current spawn path in [EntityFactory.ts](/c:/programming/TheHangout/src/world/spawning/EntityFactory.ts):

- registers `LOCAL_PLAYER`
- registers `REMOTE_PLAYER`
- branches in `createPlayer(..., { isLocal })`
- instantiates either:
  - `new LocalPlayer(...)`
  - `new RemotePlayer(...)`

That means the player split is currently encoded in:

- factory registration
- entity class names
- `EntityType`

## Current Packet Contract

The current network contract in [IEntityState.ts](/c:/programming/TheHangout/src/shared/contracts/IEntityState.ts):

- `EntityType.LOCAL_PLAYER`
- `EntityType.REMOTE_PLAYER`
- `IPlayerEntityState.type` is one of those two

This means the local/remote distinction is also embedded in the packet-level role tag.

## Current Local Responsibilities

Current `LocalPlayer` in [LocalPlayer.ts](/c:/programming/TheHangout/src/world/entities/LocalPlayer.ts) owns:

- shared avatar state inherited from `PlayerAvatarEntity` base
- local XR origin (`xrOrigin`)
- local humanoid tracking state
- local skill registration and activation
- movement update
- tracking polling
- local gesture/interaction-driven updates through skills
- local network state production
- local immediate view application
- local cleanup of skill objects

This is a mix of:

- avatar state
- local input/controller behavior
- some presentation synchronization

## Current Remote Responsibilities

Current `RemotePlayer` in [RemotePlayer.ts](/c:/programming/TheHangout/src/world/entities/RemotePlayer.ts) owns:

- shared avatar state inherited from `PlayerAvatarEntity` base
- remote target position and yaw
- remote humanoid replicated state
- remote voice stream hookup
- remote packet application
- remote interpolation
- remote timeout/disconnect logic
- remote view application

This is a mix of:

- avatar state
- remote replication behavior
- remote presence lifecycle

## Shared Responsibilities Hidden In Two Classes

Both classes effectively represent the same world thing:

- a player avatar in the shared space

Both need:

- avatar display name
- head pose and head height
- humanoid presentation state
- mic/audio state
- a view
- lifecycle and cleanup hooks

That shared role should live in one entity class.

## Target Architecture

## Core Class

### `PlayerAvatarEntity`

This becomes the single player avatar entity class.

It should own only shared avatar-role state:

- `id`
- `type` / future `entityKind`
- `isAuthority`
- `ownerId`
- `name`
- `headState`
- `headHeight`
- `audioLevel`
- `micEnabled`
- `isMuted`
- `humanoid`
- `view`

It should also own role-level methods that are valid for all player avatars:

- `applyAvatarPresentation(delta)`
- `attachControlStrategy(strategy)`
- `detachControlStrategy()`
- `getNetworkState()` or delegate to strategy if needed
- `applyNetworkState()` or delegate to strategy if needed
- `destroy()`

The shared entity should not permanently encode:

- “I am local”
- “I am remote”

Those become configuration and strategy concerns.

## Control Strategy Interface

Introduce a dedicated strategy contract, for example:

```ts
interface IPlayerAvatarControlStrategy {
  readonly mode: 'local' | 'remote';
  attach(player: PlayerAvatarEntity): void;
  detach(player: PlayerAvatarEntity): void;
  update(player: PlayerAvatarEntity, delta: number, frame?: XRFrame): void;
  applyNetworkState?(player: PlayerAvatarEntity, state: IPlayerEntityState): void;
  getNetworkState?(player: PlayerAvatarEntity, fullSync?: boolean): IPlayerEntityState | null;
}
```

The exact method names can differ, but the responsibilities should be explicit.

## Local Strategy

### `LocalPlayerControlStrategy`

This strategy owns local-control behavior:

- XR origin state
- tracking polling
- movement/grab/UI skill lifecycle
- local input-driven update order
- local state publication
- local teleport/origin movement helpers

This strategy should absorb most of what is currently unique to `LocalPlayer`.

The shared entity should expose only the state the strategy needs to manipulate.

## Remote Strategy

### `RemotePlayerReplicationStrategy`

This strategy owns remote-replica behavior:

- incoming state application
- interpolation targets and smoothing
- timeout/disconnect detection
- remote voice stream attachment lifecycle

This strategy should absorb most of what is currently unique to `RemotePlayer`.

## Ownership Of Specific Responsibilities

## Belongs In `PlayerAvatarEntity`

- avatar identity
- avatar visual state
- shared player-facing data shown to others
- view lifecycle
- humanoid pose buffer used by rendering

## Belongs In `LocalPlayerControlStrategy`

- local skill list
- active skill state
- tracking update order
- XR origin transforms
- local movement/body yaw logic
- local immediate network payload generation
- local-only helper methods like teleport/origin repositioning

## Belongs In `RemotePlayerReplicationStrategy`

- interpolation targets
- last remote update timestamp
- remote timeout rules
- remote voice stream event subscriptions
- network packet ingestion for remote avatars

## Likely To Stay In Runtime Services

Some behavior should not be pushed further into the entity:

- avatar spawning and registration
- network discovery/spawn decisions
- player presence bookkeeping
- animation system registration

These should stay in:

- `EntityFactory`
- `PlayerPresenceService`
- network runtime / replication systems

## Type Contract Changes

## `EntityType` / `EntityKind`

The player role should converge from:

- `LOCAL_PLAYER`
- `REMOTE_PLAYER`

to:

- `PLAYER_AVATAR`

This should happen in the same pass as the player unification, not earlier.

Reason:

- the current local/remote split is the same conceptual distinction we are removing from the class model
- changing only one side first creates awkward transitional semantics

## `IPlayerEntityState`

The player state contract should change from:

- `type: EntityType.LOCAL_PLAYER | EntityType.REMOTE_PLAYER`

to:

- `type: EntityType.PLAYER_AVATAR`

If local/remote metadata is still needed during transition, carry it separately:

- `controlMode?: 'local' | 'remote'`

That metadata should be transitional, not the long-term primary discriminator.

## Spawn Path Changes

## `EntityFactory`

The factory should stop registering two separate player role tokens.

Current:

- `LOCAL_PLAYER`
- `REMOTE_PLAYER`

Target:

- one player avatar registration

Example direction:

- register `PLAYER_AVATAR`
- `createPlayerAvatar(context, id, { controlMode, spawnPos, spawnYaw, color })`

The factory then:

1. creates the shared `PlayerAvatarEntity`
2. creates the requested strategy
3. attaches the strategy
4. returns one entity class regardless of control mode

## `PlayerPresenceService`

`PlayerPresenceService` should stop assuming local player creation means a different class.

Instead:

- it should request a player avatar with `controlMode: 'local'`
- it should register that shared avatar entity
- it can still set local display name and animation hooks

Its disconnect logic should later stop checking `REMOTE_PLAYER` / `LOCAL_PLAYER` strings and instead use:

- `EntityType.PLAYER_AVATAR`

## Migration Sequence

## Phase 1: Introduce Strategy Types Without Breaking Current Behavior

Add:

- `IPlayerAvatarControlStrategy`
- `LocalPlayerControlStrategy`
- `RemotePlayerReplicationStrategy`

Do not remove `LocalPlayer` or `RemotePlayer` yet.

This phase is about extracting logic into reusable units while preserving current behavior.

## Phase 2: Move Local Logic Out Of `LocalPlayer`

Extract from current `LocalPlayer`:

- skill setup
- local update ordering
- tracking sync
- local teleport/origin helpers
- local network payload generation

Move those responsibilities into `LocalPlayerControlStrategy`.

During this phase:

- `LocalPlayer` can temporarily become a thin wrapper around `PlayerAvatarEntity + LocalPlayerControlStrategy`

## Phase 3: Move Remote Logic Out Of `RemotePlayer`

Extract from current `RemotePlayer`:

- remote packet application
- interpolation
- timeout handling
- voice stream event subscription

Move those responsibilities into `RemotePlayerReplicationStrategy`.

During this phase:

- `RemotePlayer` can temporarily become a thin wrapper around `PlayerAvatarEntity + RemotePlayerReplicationStrategy`

## Phase 4: Collapse To One Entity Class

Once both wrappers are thin:

- replace `LocalPlayer` and `RemotePlayer` construction with direct `PlayerAvatarEntity` creation
- attach the desired strategy at spawn time
- remove the transitional wrapper classes

At this point:

- only `PlayerAvatarEntity` remains as the concrete avatar entity type

## Phase 5: Unify Packet And Spawn Type Tags

After the class collapse:

- replace `LOCAL_PLAYER` and `REMOTE_PLAYER` with `PLAYER_AVATAR`
- update discovery logic
- update `EntityFactory` registration
- update host/client role reversal logic in networking

This is the point where packet tags and entity role names fully align.

## Transitional Constraints

## Preserve View Behavior

The shared avatar entity must continue to support:

- direct `StickFigureView` state application
- local and remote visual differences through view state flags

The view can still accept `isLocal` as presentation input even after the entity class is unified.
That flag is a rendering concern, not necessarily a world-role concern.

## Preserve Low-Latency Local Control

The local strategy must preserve:

- current frame ordering
- local movement before tracking-dependent logic
- immediate local view correctness

This is the most sensitive part of the refactor.

## Preserve Remote Interpolation Quality

The remote strategy must preserve:

- current smoothing behavior
- timeout rules
- remote voice stream hookup

This can be extracted without changing the visible world role.

## Known Risk Areas

## Risk 1: `context.localPlayer`

`AppContext.localPlayer` is currently typed as the local-specific class.

After unification, it should become:

- `PlayerAvatarEntity | null`

or a narrow local-avatar alias if needed during transition.

Any code assuming local-only methods directly on `localPlayer` must be updated to go through the local strategy or a dedicated local-control API.

## Risk 2: `AnimationSystem`

The current animation system registers the local player directly.

If local-specific behavior moves into a strategy, the animation system should depend on:

- shared avatar data
- optional access to local-control state through a narrow interface

not on the old local-only concrete class.

## Risk 3: Network Role Reversal Logic

The current network layer treats incoming `LOCAL_PLAYER` as `REMOTE_PLAYER` for discovery.

That logic must be rewritten when `PLAYER_AVATAR` becomes the unified token.

The future decision should be:

- spawn mode is chosen from authority/control context, not from the packet type string

## Risk 4: Skill Ownership

Skills currently hang directly off the local avatar entity.

Once local control becomes a strategy:

- skills should belong to the local strategy, not the shared avatar entity

This is necessary to avoid reintroducing local-only state into the unified entity.

## Recommended Immediate Next Implementation Pass

The safest next coding step is not the full unification yet.

It is:

1. Add `IPlayerAvatarControlStrategy`
2. Introduce `LocalPlayerControlStrategy`
3. Move local-only fields and methods out of `LocalPlayer` into that strategy
4. Keep `LocalPlayer` as a transitional wrapper that owns a `PlayerAvatarEntity` base plus the new strategy

That gives us the biggest reduction in conceptual debt while preserving the current network contract.

Only after that should we extract the remote strategy and remove the wrapper classes.

## End-State Test

The refactor is complete when:

- there is one player avatar entity class
- local vs remote behavior is provided by attached strategy objects
- packet role tags no longer distinguish local vs remote player
- a new contributor can read the entity model without inferring perspective-specific class roles

If the code still needs “local” and “remote” in the primary avatar class names, the refactor is not finished.
