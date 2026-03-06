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

## Compatibility Scope

- Existing object code using `mountLocal/unmountLocal/isMountedLocal` still works.
- Chair keeps the same user-facing interaction model (trigger to sit/stand), but now converges through host-authoritative occupancy decisions.
- The mount runtime API is backward compatible while exposing request/grant/reject/release primitives for newer objects.

## Host-Authoritative Pattern (Implemented for Chair)

`ChairObject` now follows this replication flow:

1. Guest interaction emits `mount-request` (or `mount-release-request`) with `localEcho: false`.
2. Host receives event and validates actor identity from replication `meta.senderId` (not from payload claims).
3. Host applies state if valid and emits authoritative `occupancy` update for all peers.
4. If invalid, host emits `mount-rejected` containing `playerId` and `reason`; non-target peers ignore it.

This is the recommended baseline for future mountables:

- object keeps mount occupancy and rules self-contained.
- host remains authoritative on acceptance/release.
- clients mount/unmount locally only from authoritative occupancy convergence.
