# The Hangout: Object Authoring API Plan

## Purpose

This document defines a contributor-facing authoring API for content objects.

The goal is to make it practical to implement:

- simple props (balls, cubes, toys)
- medium-complexity interactables (chairs, doors, handles, levers)
- equipment and tools (bow, arrow, gun)
- self-contained gameplay objects (a gun that owns its own shooting minigame logic)
- multi-part locomotion or mountable objects (simple vehicles)

without requiring contributors to learn broad engine internals first.

This is the next layer above the current object-instance architecture.

## Design Goal

A content author should be able to build most objects by learning:

1. the object module interface
2. the object runtime context
3. the object lifecycle base class
4. a small set of capability hooks

They should not need to know:

- the full `AppContext`
- global event bus internals
- how replication channels are registered
- how cleanup is manually coordinated across multiple engine systems

## Scope

This API is for content objects that live in scenarios and can:

- create visuals
- create colliders
- react to interaction
- optionally own replicated state
- optionally spawn secondary objects
- optionally drive local update logic

This API is not intended to replace:

- avatar replication
- global physics synchronization
- low-level renderer internals
- transport-layer networking

It is an authoring layer, not a new engine core.

## Core Principles

1. Keep the content contract small and readable.
2. Expose a narrow authoring context instead of full engine globals.
3. Make cleanup explicit but easy.
4. Make replication opt-in and ergonomic.
5. Support both simple single-file objects and larger split implementations.
6. Prefer capability composition over deep inheritance.
7. Allow an object to own more than one entity, mesh, or collider.
8. Allow an object to spawn or manage child objects when that is part of its gameplay role.

## Why This Abstraction Makes Sense

Yes, this should be abstracted behind an authoring API.

The examples you listed all fit the same general shape:

- they are world objects
- they own their own local rules
- they may have interaction entry points
- they may have transient or persistent state
- some need sync
- some need child objects
- some may “mount” or temporarily control a player

Those are all object-authoring concerns.

What varies is complexity, not the need for an object API.

## The Key Requirement

The API must support a ladder of complexity:

### Level 1: Simple Prop

Example:

- a ball that can be thrown

Needs:

- mesh
- physics body
- maybe one collider
- maybe no custom replication

### Level 2: Single Interactable

Examples:

- chair
- door with handle

Needs:

- interaction hooks
- local state (`occupied`, `openAmount`, `latched`)
- optional replicated semantic state

### Level 3: Tool / Weapon

Examples:

- bow and arrow
- gun

Needs:

- held state
- trigger/use logic
- child object spawning (arrow, projectile, muzzle effect)
- cooldown / ammo / local feedback
- usually replicated semantic actions

### Level 4: Compound Gameplay Object

Example:

- a gun that contains and controls a small shooting minigame

Needs:

- own state machine
- child spawn control
- score / phase / reset logic
- local feedback and replicated semantic state

### Level 5: Mountable / Drivable Object

Example:

- simple vehicle

Needs:

- seat / occupancy control
- ownership of movement state
- mount / dismount flow
- temporary control routing
- possibly multiple interaction points

The same API should support all of these by composition.

## Proposed Authoring Layers

## 1. `IObjectModule`

This remains the content definition entry point.

It should stay small:

```ts
export interface IObjectModule {
    id: string;
    displayName: string;
    tags?: string[];
    networked?: boolean;
    portable?: boolean;

    spawn(
        context: IObjectRuntimeContext,
        config: IObjectSpawnConfig
    ): ISpawnedObjectInstance | null;
}
```

The change is that authors should receive `IObjectRuntimeContext`, not raw `AppContext`.

## 2. `IObjectRuntimeContext`

This is the main contributor-facing authoring surface.

It should be a narrow facade over the engine, exposing only object-relevant operations.

### Suggested Shape

```ts
export interface IObjectRuntimeContext {
    app: AppContext;
    instanceId: string;

    scene: {
        add(object: THREE.Object3D): void;
        remove(object: THREE.Object3D): void;
    };

    physics: {
        createStaticCuboid(...): RigidBodyLike | null;
        createDynamicCuboid(...): RigidBodyLike | null;
        removeBody(body: RigidBodyLike | null | undefined): void;
        onCollision(callback: ObjectCollisionCallback): ICleanupHandle;
    };

    audio: {
        playDrumPadHit(...): void;
        playOneShot?(id: string, options?: unknown): void;
    };

    sync: {
        emit(eventType: string, data: unknown): void;
    };

    interaction: {
        mountPlayer?(playerId: string, seatId?: string): boolean;
        unmountPlayer?(playerId: string): void;
    };

    objects: {
        spawn(moduleId: string, config?: IObjectSpawnConfig): ISpawnedObjectInstance | null;
        remove(instanceId: string): void;
        get(instanceId: string): ISpawnedObjectInstance | undefined;
    };

    onCleanup(cleanup: () => void): void;
}
```

Not every method must exist in phase 1.
But this is the correct direction.

### Why This Matters

This keeps authors from reaching directly into:

- `context.runtime.physics`
- `context.runtime.session`
- global `eventBus`
- `context.runtime.entity`

That is the separation the current `DrumPadArcObject` still lacks.

## 3. `BaseObjectInstance`

This should be the default base class for most content objects.

Its main job is lifecycle ergonomics.

### Responsibilities

- track cleanup callbacks
- track owned scene objects
- track owned physics bodies
- expose helper methods for registering those resources
- make `destroy()` safe and predictable

### Suggested Shape

```ts
export abstract class BaseObjectInstance implements ISpawnedObjectInstance {
    public readonly id: string;
    public readonly moduleId: string;

    protected constructor(
        protected context: IObjectRuntimeContext,
        moduleId: string
    ) {
        this.id = context.instanceId;
        this.moduleId = moduleId;
    }

    protected ownSceneObject(object: THREE.Object3D): THREE.Object3D;
    protected ownPhysicsBody(body: RigidBodyLike | null): RigidBodyLike | null;
    protected addCleanup(cleanup: () => void): void;

    public update(delta: number): void {}
    public destroy(): void;
}
```

That removes a large amount of repetitive cleanup code from object implementations.

## 4. `BaseReplicatedObjectInstance`

This should extend `BaseObjectInstance` and add the ergonomic replication surface.

### Responsibilities

- expose `emitSyncEvent(...)`
- maintain a generated `replicationKey`
- provide default no-op snapshot hooks

### Suggested Shape

```ts
export abstract class BaseReplicatedObjectInstance
    extends BaseObjectInstance
    implements IReplicatedObjectInstance {

    public readonly replicationKey: string;

    protected emitSyncEvent(eventType: string, data: unknown): void;

    public abstract onReplicationEvent(
        eventType: string,
        data: unknown,
        meta: IObjectReplicationMeta
    ): void;

    public captureReplicationSnapshot?(): unknown;
    public applyReplicationSnapshot?(snapshot: unknown): void;
}
```

This makes the sync pattern much easier to discover and reuse.

## Capability Model

The API should support optional object capabilities instead of giant monolithic interfaces.

These are content-facing, not low-level engine contracts.

## `IInteractableObject`

For objects with semantic interaction entry points.

```ts
export interface IInteractableObject {
    onInteract?(event: IObjectInteractEvent): void;
    canInteract?(event: IObjectInteractEvent): boolean;
}
```

Examples:

- chair
- door handle
- lever
- button

## `IGrabbableObject`

For objects that are conceptually content-owned but may be held, equipped, or manipulated.

```ts
export interface IGrabbableObject {
    onGrab?(event: IObjectGrabEvent): void;
    onRelease?(event: IObjectReleaseEvent): void;
}
```

Examples:

- bow
- gun
- magic wand

## `IMountableObject`

For objects that temporarily attach or constrain a player.

```ts
export interface IMountableObject {
    canMount?(playerId: string, seatId?: string): boolean;
    mount?(playerId: string, seatId?: string): boolean;
    unmount?(playerId: string): void;
}
```

Examples:

- chair
- vehicle seat
- turret

This is especially important for sit/drive behavior.

## `IChildObjectOwner`

For compound objects that spawn or manage secondary object instances.

```ts
export interface IChildObjectOwner {
    getChildInstanceIds?(): string[];
}
```

Examples:

- bow spawns arrow
- gun spawns targets/projectiles
- puzzle controller spawns transient puzzle state props

This is the abstraction that allows “a gun that owns its own minigame.”

## `IStatefulObject`

For objects with serializable local gameplay state.

```ts
export interface IStatefulObject<TState> {
    getState?(): TState;
    applyState?(state: TState): void;
}
```

This can be used with or without network sync.

## Interaction Authoring Model

The current engine still uses low-level entity interaction and skills.

The authoring API should sit above that by exposing semantic hooks.

### Authoring Rule

The object author should describe *what happens*:

- sit down
- open door
- fire shot
- enter vehicle

The engine/runtime integration layer should handle *how the input got there*.

### Practical Example: Chair

A chair object should be able to implement:

- occupancy state
- mount/unmount behavior
- player reposition to seat pose
- release condition when the player stands or triggers exit

It should not need to care about controller buttons directly.

### Practical Example: Door With Handle

A door object should be able to implement:

- latch state
- handle interact
- swing open/close
- optional locked/unlocked state

It should not need to know about global event names or raw device input.

## Child Object Support

This is required for your more complex examples.

Some objects are not just one object. They are object clusters with one root owner.

Examples:

- bow owns arrow spawn behavior
- gun owns targets/projectiles/round state
- vehicle owns seats and maybe wheel/engine sub-state

The authoring API should therefore support:

- spawning child objects from inside an object
- tracking and cleaning them up automatically
- optionally keeping child state private to the parent object

### Minimum Requirement

`IObjectRuntimeContext.objects.spawn(...)` must be available to object instances.

### Important Rule

Child objects should still be normal object instances.
They should not require special engine exceptions.

## Mounting and Control Transfer

This is the hardest area, but it still belongs behind the API.

Examples:

- chair: “sit” locks avatar to a seat
- vehicle: “drive” routes movement input into vehicle control

The authoring API should not directly rewire low-level input systems.
Instead, it should expose semantic operations such as:

- request mount
- release mount
- set seat transform
- optionally designate a driver seat

That means there is likely a future engine-side helper needed:

- `MountRuntime` or equivalent

But the object API should already leave room for this.

## Physics Authoring Model

The API should support three common patterns:

1. passive static colliders
2. active dynamic bodies
3. engine-owned wrapped primitives

### Pattern A: Static Scene Object

Example:

- drum pad
- wall trigger
- handle hit area

Needs:

- create static collider
- subscribe to collisions

### Pattern B: Self-Owned Dynamic Body

Example:

- rolling ball implemented as a pure content object

Needs:

- create body
- update/view sync
- optional ownership rules

### Pattern C: Wrapped Engine Primitive

Example:

- grabbable cube
- pen

Needs:

- spawn a low-level entity via wrapper object module

The authoring API should support all three, not force one pattern.

## Suggested Contributor Workflow

A new contributor implementing a normal object should be able to do:

1. create `MyObject.ts` in `content/objects/`
2. extend `BaseObjectInstance` or `BaseReplicatedObjectInstance`
3. use `IObjectRuntimeContext` helpers for scene, physics, sync, cleanup
4. export an `IObjectModule`
5. add it to a scenario

That is the intended workflow.

## Example Fit For Your Use Cases

## Ball

Best fit:

- simple object module
- likely wraps a low-level physics prop at first
- may later become a content-owned dynamic object if needed

## Chair

Best fit:

- content object with `IMountableObject`
- own seat state
- interact to mount
- unmount on user action or movement threshold

## Door With Handle

Best fit:

- content object with `IInteractableObject`
- stateful open/closed/locked state
- maybe replicated semantic state

## Bow And Arrow

Best fit:

- bow object owns held state
- spawns arrow child objects
- child arrows are normal object instances or wrapped primitives

## Gun With Embedded Minigame

Best fit:

- parent gun object as `IChildObjectOwner`
- parent owns game phase, targets, score, cooldowns
- child targets/projectiles are spawned content objects

This is a valid use case for the API and should be supported.

## Drivable Vehicle

Best fit:

- mountable object with one or more seats
- driver seat routes semantic control into object-owned motion state
- may spawn wheels/effects as child objects or keep them internal

This is a more advanced use case, but still the same architectural category.

## Immediate Gaps In The Current Code

These are the specific problems still visible in `DrumPadArcObject` today:

- raw `AppContext` is exposed instead of a narrow object context
- direct use of `context.runtime.*` internals
- direct use of global `eventBus`
- manual cleanup bookkeeping
- no first-class helper for child-object ownership
- no first-class mount/seat abstraction

Those are the things this plan needs to fix.

## Recommended Implementation Phases

## Phase 1: Narrow Authoring Context

Add:

- `IObjectRuntimeContext`
- initial helper facade for:
  - scene add/remove
  - physics body create/remove
  - sync emit
  - cleanup registration
  - object spawn/get/remove

Goal:

- stop handing full `AppContext` to content authors

## Phase 2: Base Instance Classes

Add:

- `BaseObjectInstance`
- `BaseReplicatedObjectInstance`

Goal:

- remove repetitive cleanup and sync boilerplate

## Phase 3: Refactor Existing Objects Onto The API

First targets:

- `DrumPadArcObject`
- `DrawingSurfaceObject`
- `DebugBeaconObject`

Goal:

- prove the authoring API works for:
  - local-only objects
  - replicated state objects
  - interaction-heavy objects

## Phase 4: Add Capability Helpers

Add:

- `IMountableObject`
- `IInteractableObject`
- optional child-object ownership helpers

Goal:

- support chairs, doors, and compound gameplay objects cleanly

## Phase 5: Add Mount/Seat Runtime Support

Add engine-side support for:

- seat occupancy
- mount/unmount semantics
- temporary player attachment/control routing

Goal:

- make chairs and vehicles first-class content patterns

## Suggested File Targets

- `src/content/contracts/IObjectRuntimeContext.ts`
- `src/content/contracts/IInteractableObject.ts`
- `src/content/contracts/IMountableObject.ts`
- `src/content/runtime/BaseObjectInstance.ts`
- `src/content/runtime/BaseReplicatedObjectInstance.ts`
- `src/content/runtime/ObjectRuntimeContext.ts`

Optional later:

- `src/content/runtime/MountRuntime.ts`
- `src/content/runtime/ObjectCapabilityHelpers.ts`

## Definition Of Done

This authoring API is successful when:

- a contributor can build a simple object from the contracts alone
- a contributor can build a replicated object without learning transport internals
- a contributor can build an interactable without learning global event bus internals
- object cleanup is hard to get wrong
- complex compound objects can spawn and manage child objects without special engine exceptions
- chairs, doors, tools, weapons, and vehicles all fit naturally into the same model

At that point, the object layer is genuinely a contributor-facing authoring API,
not just a thin wrapper over engine internals.
