# Mounting V2 Scaffolding

This document describes the first step toward a generalized mount system for VR objects (chairs, cars, bikes, moving platforms).

## Goals

- Keep mount behavior object-owned and self-contained.
- Keep engine/runtime APIs generic and reusable.
- Support host-authoritative mount flows in a later step without rewriting object code.

## New Contracts

- [IMounting.ts](src/content/contracts/IMounting.ts)
  - `ILocalMountBinding`: local mount binding with `ownerInstanceId`, optional `mountPointId`, seat/exit pose providers.
  - `TLocalMountState`: `idle | requesting | mounted | releasing | rejected`.
  - `ILocalMountStatus`: debug/status snapshot of current local mount state.
- [IMountableObjectV2.ts](src/content/contracts/IMountableObjectV2.ts)
  - Object-facing mount point and request/release hooks for future multi-seat and vehicle-like objects.

## MountRuntime API

[MountRuntime.ts](src/content/runtime/MountRuntime.ts) now exposes a state-machine-shaped API:

- `requestLocalMount(binding)` -> enters `requesting`, then currently grants immediately.
- `grantLocalMount(binding)` -> enters `mounted` and teleports to seat pose.
- `rejectLocalMount()` -> enters `rejected`.
- `releaseLocalMount(ownerInstanceId?, reason?)` -> releases current mount.
- Existing compatibility methods remain:
  - `mountLocal(...)` delegates to `grantLocalMount(...)`
  - `unmountLocal(...)` now accepts optional `reason`.
- Debug/status hooks:
  - `getLocalMountStatus()`
  - `onLocalMountStateChanged(listener)`

## Object Runtime Context

[IObjectRuntimeContext.ts](src/content/contracts/IObjectRuntimeContext.ts) and [ObjectRuntimeContext.ts](src/content/runtime/ObjectRuntimeContext.ts) now expose the same extended mount API so object modules can adopt the new flow incrementally.

## Non-Breaking Scope

- Existing chair behavior remains unchanged.
- Existing object code using `mountLocal/unmountLocal/isMountedLocal` still works.
- The new API is scaffolding for the next step: host-authoritative mount request/grant/reject/release replication.

