# The Hangout: Replicated Object Instance Architecture Spec

## Purpose

This document defines the missing content-layer abstraction needed to make
spawned objects fully self-contained, including:

- local visuals
- local interaction logic
- replicated semantic events
- replicated snapshot state for late joiners
- clean teardown on scenario switch

The goal is to let future content objects stay small and scenario-local
without hardcoding a new engine-level feature for each synced behavior.

This spec is the bridge between the current `IObjectModule` system and the
existing `FeatureReplicationService`.

## Current Gap

The current architecture already supports:

- scenario-local object catalogs via `IObjectModule`
- content-facing spawning via `ObjectModuleRegistry`
- session-wide semantic replication via `FeatureReplicationService`
- late-join snapshots for registered replicated features

What it does not yet support cleanly is:

- per-object-instance replication ids
- object-local registration/unregistration with replication
- object instances that are more than a raw `IEntity`
- scenario cleanup of non-entity object runtime state

That is why `DrawingFeature` is still a global hardcoded feature instead of
being a spawned object.

## Target Design

The content system should support three layers:

1. `IObjectModule`
2. `ISpawnedObjectInstance`
3. optional `IReplicatedObjectInstance`

This keeps object definitions small while making sync an opt-in capability.

## Design Principles

- object modules stay content-facing and simple
- spawned object instances own their own lifecycle
- replication is optional, not required for every object
- replication ids are per instance, not just per feature type
- object authors should define behavior, not transport plumbing
- scenario unload must fully remove object visuals, entities, listeners, and sync hooks

## Current `IObjectModule` Constraint

Today `IObjectModule.spawn(...)` returns only `IEntity | null`.

That is too narrow for future content because some object modules may need:

- an entity plus helper state
- multiple internal entities
- no entity at all, just a runtime visual/controller object

So the object system needs a runtime instance abstraction.

## New Core Contracts

## `ISpawnedObjectInstance`

This is the base runtime contract for spawned content instances.

```ts
import type { IEntity } from './src/shared/contracts/IEntity';
import type { IUpdatable } from './src/shared/contracts/IUpdatable';

export interface ISpawnedObjectInstance extends IUpdatable {
    id: string;
    moduleId: string;

    // Optional primary entity if the object is centered on one entity.
    getPrimaryEntity?(): IEntity | null;

    // Optional additional entity ids owned by this instance.
    getOwnedEntityIds?(): string[];

    // Called when the instance is being removed by scenario unload,
    // object despawn, or world teardown.
    destroy(): void;
}
```

Important:
This should be the unit tracked by the session/scenario runtime, not just entity ids.

## `IReplicatedObjectInstance`

This extends the spawned object with optional sync hooks.

```ts
export interface IReplicatedObjectInstance extends ISpawnedObjectInstance {
    replicationKey: string;

    onReplicationEvent(
        eventType: string,
        data: unknown,
        meta: {
            eventId: string;
            originPeerId: string;
            senderId: string | null;
            local: boolean;
            sentAt: number;
        }
    ): void;

    captureReplicationSnapshot?(): unknown;
    applyReplicationSnapshot?(snapshot: unknown): void;
}
```

This keeps the per-object sync hooks aligned with the existing feature replication semantics.

## Updated `IObjectModule`

The content definition should be widened so it can produce object instances.

### Current

```ts
spawn(context, config): IEntity | null
```

### Target

```ts
import type { AppContext } from './src/app/AppContext';

export interface IObjectSpawnContext {
    app: AppContext;
    instanceId: string;
}

export interface IObjectModule {
    id: string;
    displayName: string;
    tags?: string[];
    networked?: boolean;
    portable?: boolean;

    spawn(
        context: IObjectSpawnContext,
        config: IObjectSpawnConfig
    ): ISpawnedObjectInstance | null;
}
```

Notes:

- `instanceId` should be assigned by the runtime, not invented ad hoc by the object.
- `networked` is only a capability hint, not a full implementation.

## New Runtime Helpers

## `ObjectInstanceRegistry`

This should be the runtime owner for spawned object instances.

It should:

- register active spawned object instances
- update them each frame
- destroy them on scenario unload
- expose lookup by id
- optionally route replication to them

Suggested responsibilities:

```ts
class ObjectInstanceRegistry {
    spawn(moduleId, config): ISpawnedObjectInstance | null;
    add(instance: ISpawnedObjectInstance): void;
    remove(instanceId: string): void;
    removeAll(): void;
    get(instanceId: string): ISpawnedObjectInstance | undefined;
    list(): ISpawnedObjectInstance[];
    update(delta: number): void;
}
```

This replaces the current narrow `scenarioEntityIds` tracking in `SessionRuntime`.

## `ObjectReplicationHost`

This is the missing adapter between object instances and `FeatureReplicationService`.

It should:

- assign a stable replication id per object instance
- register/unregister replicated object instances with the replication service
- translate feature events into object-instance callbacks
- translate snapshot calls into object-instance snapshot hooks

The key point:
object authors should not manually interact with `FeatureReplicationService`
for basic per-instance sync.

### Suggested Replication Key Format

Use a stable scoped pattern:

- `object:<moduleId>:<instanceId>`

Examples:

- `object:drawing-surface:draw-1`
- `object:music-pad:pad-4`
- `object:escape-lock:lock-main-door`

This avoids collisions between multiple instances of the same module type.

## Recommended Internal Adapter Shape

This should likely be implemented as a tiny wrapper that satisfies the current
`IReplicatedFeature` contract:

```ts
class ObjectReplicationChannel implements IReplicatedFeature {
    public readonly featureId: string;

    constructor(private instance: IReplicatedObjectInstance) {
        this.featureId = instance.replicationKey;
    }

    public onEvent(eventType: string, data: unknown, meta: ReplicationMeta): void {
        this.instance.onReplicationEvent(eventType, data, meta);
    }

    public captureSnapshot?(): unknown {
        return this.instance.captureReplicationSnapshot?.();
    }

    public applySnapshot?(snapshot: unknown): void {
        this.instance.applyReplicationSnapshot?.(snapshot);
    }
}
```

That lets the current replication system remain intact while content gets a cleaner authoring model.

## Lifecycle Ownership

## Who Owns What

### `SessionRuntime`

Should own:

- the active scenario
- the object module registry for the active scenario
- the object instance registry
- scenario-wide cleanup and transition policy

Should not directly own:

- object-local replicated state
- object-local visuals
- object-local event subscriptions

### `ObjectInstanceRegistry`

Should own:

- active runtime object instances
- destroy-on-unload behavior
- optional per-frame update calls

### `ObjectReplicationHost`

Should own:

- replication registration/unregistration
- per-instance feature ids
- transport plumbing only

### Object Instance

Should own:

- local object behavior
- local visual state
- local interaction logic
- object-specific replicated event handling
- object-specific snapshot serialization

## Scenario Unload Semantics

On scenario unload:

1. scenario-owned object instances must be destroyed
2. their replication channels must be unregistered
3. their entities must be removed
4. their visual groups must be removed
5. their event listeners must be unsubscribed

This is the key reason the runtime must track instances, not only entity ids.

## Recommended Authoring Pattern

A content author should be able to write a small synced object like this:

1. define the module
2. return a spawned instance
3. optionally implement replication hooks

The intended boilerplate should stay small:

```ts
class SharedSketchPadInstance implements IReplicatedObjectInstance {
    public readonly replicationKey: string;

    private strokes: Stroke[] = [];

    constructor(
        public readonly id: string,
        public readonly moduleId: string,
        private context: AppContext
    ) {
        this.replicationKey = `object:${moduleId}:${id}`;
    }

    public update(delta: number): void {
        // Optional animation/update logic
    }

    public destroy(): void {
        // Remove visuals and local resources
    }

    public onReplicationEvent(eventType: string, data: unknown): void {
        if (eventType === 'stroke') {
            this.applyStroke(data as Stroke, false);
        }
    }

    public captureReplicationSnapshot(): unknown {
        return { strokes: this.strokes };
    }

    public applyReplicationSnapshot(snapshot: unknown): void {
        // Restore strokes for late joiners
    }

    public addStroke(stroke: Stroke): void {
        this.applyStroke(stroke, true);
    }
}
```

That is the intended complexity target.

## Migration Path For Drawing

Drawing is the best proof-of-concept for this design.

## Current State

`DrawingFeature` is session-global.

It currently:

- stores stroke state
- renders line geometry
- emits replicated stroke events
- snapshots stroke history for late joiners

## Target State

Move drawing to a spawned object such as:

- `DrawingSurfaceObject`
- `SharedSketchPadObject`
- or a pen-owned replicated drawing channel

Recommended approach:

- keep the pen as a tool object
- move the actual shared stroke state into a spawned drawing surface instance

That keeps the networked state tied to something explicit in the world.

## Practical Drawing Migration Sequence

1. Add the new object-instance contracts.
2. Add the object instance registry and replication host.
3. Convert `IObjectModule.spawn()` to return `ISpawnedObjectInstance`.
4. Add a `DrawingSurfaceObject` module that owns stroke state and rendering.
5. Replace direct `context.runtime.drawing.addSegment(...)` calls with routing to the active drawing object instance.
6. Remove or reduce `DrawingFeature` into a reusable helper.

## Late-Join Sync Model

Late joiners should not need custom engine code per object type.

The generic rule should be:

- if an object instance implements `captureReplicationSnapshot`
- and its replication channel is registered
- it automatically participates in `FeatureReplicationService.createSnapshotPayload()`

That means late-join state remains generic and object-local.

## Scope Boundaries

## What This Layer Should Handle

- semantic object events
- medium-frequency object state
- late-join snapshots
- scenario-owned object cleanup

## What This Layer Should Not Handle

- high-frequency avatar transforms
- physics body state streaming
- ownership transfer of general physics props

Those already belong to specialized engine sync paths.

This object sync layer is for content semantics, not transform replication.

## Backward Compatibility Strategy

This should be introduced incrementally.

## Phase 1

- add `ISpawnedObjectInstance`
- add `IReplicatedObjectInstance`
- add `ObjectInstanceRegistry`
- keep `IObjectModule.spawn()` backward-compatible temporarily by adapting plain `IEntity`

## Phase 2

- add `ObjectReplicationHost`
- allow spawned instances to register optional replication channels

## Phase 3

- migrate one proof-of-concept synced object
- recommended first target: drawing

## Phase 4

- switch `SessionRuntime` from `scenarioEntityIds` to full instance tracking
- remove old one-off cleanup assumptions

## Suggested File Targets

- `src/content/contracts/ISpawnedObjectInstance.ts`
- `src/content/contracts/IReplicatedObjectInstance.ts`
- `src/content/runtime/ObjectInstanceRegistry.ts`
- `src/content/runtime/ObjectReplicationHost.ts`
- `src/content/runtime/ObjectReplicationChannel.ts`

Possible helper base classes:

- `src/content/runtime/BaseSpawnedObjectInstance.ts`
- `src/content/runtime/BaseReplicatedObjectInstance.ts`

## Definition Of Done

This layer is correctly implemented when:

- a scenario can spawn multiple instances of the same synced object module
- each instance has its own replicated state
- late joiners receive those instance snapshots automatically
- scenario unload destroys the instances and unregisters their replication
- content authors can implement synced objects without adding new hardcoded engine features

At that point, drawing and similar future objects become normal content modules,
not special global subsystems.
