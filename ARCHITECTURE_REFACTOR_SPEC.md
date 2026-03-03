# The Hangout: Refactor Target Architecture Spec

## Purpose

This document defines the target module structure and naming rules for the next large refactor.
The goal is to make the codebase easier to navigate, easier to extend, and safer to change with
an automated move/rename script.

This is a structure and naming refactor first. It is not a full behavioral rewrite.

## Refactor Goals

- Make module boundaries obvious from file paths and names.
- Remove ambiguity between "manager", "system", "controller", and "feature".
- Separate stable engine infrastructure from game-world logic and feature code.
- Keep input translation isolated from gameplay logic.
- Keep networking concerns isolated from world simulation and rendering.
- Make future mod/plugin loading possible by reducing hidden cross-domain coupling.

## Core Architectural Rules

### 1. Composition Root

There is one application composition root that wires the runtime together.

- `app/` owns bootstrap, lifecycle, dependency registration, and frame-loop assembly.
- No other domain should act as a secondary global composition root.
- Runtime dependencies are registered explicitly in one place.

### 2. Domain Boundaries

Each top-level folder represents a domain, not an implementation style.

- Top-level folders should answer "what part of the product is this?"
- Subfolders answer "what role does this module play inside that domain?"
- We do not organize the whole app by generic technical labels alone.

### 3. Runtime Role Taxonomy

Names must describe runtime responsibility, not just historical usage.

- `Manager`: long-lived runtime service that owns resources, integration points, or subsystem lifecycle.
- `System`: frame-loop logic unit with `update(delta)` and minimal external ownership concerns.
- `Controller`: adapter that translates one interface into another, especially user/device input.
- `Service`: domain API that coordinates logic but does not primarily own render/physics/network resources.
- `Registry`: lookup/store of objects by id or type.
- `Factory`: object creation module.
- `Feature`: self-contained gameplay capability that may own local state, events, and optional replication.
- `Provider`: pluggable implementation behind an interface contract.

Use these names narrowly. Do not use `Manager` as the default suffix.

### 4. Separation of Data, Contracts, and Implementation

- Pure interfaces and serializable data types live in `shared/`.
- Domain-specific implementations live in their respective domains.
- Shared types should not depend on runtime services.

### 5. Input Translation Rule

Gameplay and world logic must not care whether input came from XR, desktop, or mobile.

- Input code translates device state into spatial intents and interaction requests.
- World and entity logic consume those spatial intents only.
- Input modules may depend on world/query APIs, but world logic must not depend on device APIs.

### 6. Entity Rule

Entities define world behavior and interaction capabilities.

- Entities may be visualized, networked, and simulated through separate systems.
- Entities should not directly own rendering backends.
- Entity-specific views stay in render-facing modules.
- Physics support is optional for entities.

### 7. Feature Rule

Feature modules should be isolated and removable where practical.

- Drawing, social effects, remote desktop, and similar gameplay slices live as features.
- Feature modules may integrate with network/physics/render, but they should not become new "god managers".

## Target Top-Level Structure

This is the target `src/` layout.

```text
src/
  app/
    App.ts
    AppContext.ts
    RuntimeRegistry.ts
    Engine.ts
    events/

  shared/
    contracts/
    types/
    constants/
    math/
    utils/

  network/
    transport/
    protocol/
    replication/
    session/

  world/
    session/
    level/
    entities/
    spawning/

  features/
    drawing/
    social/
    remoteDesktop/

  input/
    providers/
    controllers/
    intents/

  physics/
    runtime/
    systems/
    queries/

  render/
    runtime/
    views/
    avatar/
    effects/
    debug/

  ui/
    flat/
    vr/
    hud/

  media/
    voice/
    audio/
    music/

  assets/
    runtime/
    loaders/
    procedural/
    metadata/
```

## Target Domain Definitions

### `app/`

Owns process startup and the runtime graph.

- Bootstrapping
- Engine loop
- Global context / dependency access
- Event map / application-level event bus wiring

Should contain the only place where all major subsystems are assembled.

### `shared/`

Contains low-level reusable code that should remain portable.

- Contracts (`IUpdatable`, `IView`, network packet shapes, interaction interfaces)
- Data shapes (`IPose`, vectors, humanoid state if kept generic)
- Constants
- Generic utility functions

No domain-heavy module should be placed here just because it is "used in many places".

### `network/`

Owns transport and synchronization, not gameplay semantics.

- Peer/WebSocket transport
- Packet dispatching
- Network protocol definitions
- Continuous state synchronization
- Replication infrastructure
- Session host/join connection flow

`network/` may know about shared contracts and world entity snapshots.
It should not own rendering or gameplay feature behavior.

### `world/`

Owns world/session state and the authoritative game-space model.

- Session runtime state
- Level loading/application
- Entity lifecycle and spawning
- Player presence in the world

This is where "what exists in the world" is coordinated.

### `features/`

Owns modular gameplay slices.

- Drawing
- Social effects
- Remote desktop / screen sharing interaction if kept as in-world feature

Each feature should expose a clear entry surface and keep internal helpers local.

### `input/`

Owns hardware-specific adaptation.

- Tracking providers
- Keyboard/gamepad/mobile/XR adapters
- Spatial intent generation
- Interaction controllers for non-XR modes

This domain is allowed to query world state but should not mutate world internals directly except through explicit interfaces.

### `physics/`

Owns simulation backend and physics-facing systems.

- Rapier world setup
- Rigid body and collider lifecycle
- Ownership/contact queries
- Physics update loop
- Physics-to-world presentation sync

### `render/`

Owns all rendering implementation details.

- Scene/camera/renderer lifecycle
- Entity views
- Avatar rendering
- Particle and debug rendering
- Visual-only components

### `ui/`

Owns interfaces for joining, menus, HUD, and XR panels.

- Flat pre-session UI
- In-world VR UI
- HUD overlays

### `media/`

Owns audio/voice/media transport integrations.

- Voice I/O
- Spatial audio playback
- Synth/music generation

### `assets/`

Owns asset creation and loading.

- Procedural asset generation
- External asset loaders
- Gameplay metadata adapters

## Naming Rules

### File Naming

- Use `PascalCase.ts` for exported classes and interfaces.
- Match the filename to the primary exported symbol.
- Avoid vague filenames such as `Types.ts` inside a broad domain unless the scope is extremely local.

### Class Naming

- Classes must be named for role plus domain, not implementation history.
- Prefer `SessionRuntime`, `WorldSessionService`, `RenderRuntime`, `PhysicsRuntime`.
- Avoid generic names like `Manager` without a domain prefix.

### Interface Naming

- Keep `I*` prefixes only for actual behavioral contracts that are already widely used.
- Avoid creating new one-off `I*` interfaces if a type alias or specific object type is clearer.
- Group shared contracts under `shared/contracts/`.

### Suffix Rules

- `*Manager`: only for resource-owning subsystem runtimes.
- `*System`: only for frame-updated logic.
- `*Controller`: input/UI bridge logic.
- `*Provider`: pluggable implementation behind an abstraction.
- `*Component`: render-only or UI-only attachable behavior.
- `*State`: pure state container or serializable data.
- `*Runtime`: primary long-lived domain runtime when `Manager` is too vague.

### Folder Naming

- Use singular domain folders (`network`, `render`, `physics`) at the top level.
- Use subfolders for role-based grouping within a domain.
- Do not create "misc" buckets.

## Runtime Registration Rules

The current `context.managers` registry should evolve into a role-neutral runtime registry.

Target direction:

- `context.managers` becomes `context.runtime` or `context.services`.
- The registry key names should reflect domains, not historical class suffixes.
- Registry keys should not imply all entries are managers.

Example target keys:

- `world`
- `network`
- `render`
- `physics`
- `input`
- `ui`
- `hud`
- `audio`
- `assets`
- `replication`
- `interaction`

This can be done in a later step if we want to limit the first migration to filesystem and class names.

## First-Pass Current-to-Target Mapping

This is the first concrete mapping for the current codebase. It is intentionally conservative:
it favors moves and renames over behavioral decomposition.

### App Core

- `src/core/App.ts` -> `src/app/App.ts`
- `src/core/GameState.ts` -> `src/app/AppContext.ts`
- `src/core/GameEngine.ts` -> `src/app/Engine.ts`
- `src/core/EventBus.ts` -> `src/app/events/EventBus.ts`
- `src/core/AppEventMap.ts` -> `src/app/events/AppEventMap.ts`

### Shared Contracts and Utilities

- `src/interfaces/*` -> `src/shared/contracts/*`
- `src/models/HandState.ts` -> `src/shared/types/HandState.ts`
- `src/models/HumanoidState.ts` -> `src/shared/types/HumanoidState.ts`
- `src/utils/Constants.ts` -> `src/shared/constants/Constants.ts`
- `src/utils/MathUtils.ts` -> `src/shared/math/MathUtils.ts`
- `src/utils/TypeGuards.ts` -> `src/shared/utils/TypeGuards.ts`
- `src/utils/DeviceUtils.ts` -> `src/shared/utils/DeviceUtils.ts`
- `src/utils/GestureUtils.ts` -> `src/shared/utils/GestureUtils.ts`
- `src/utils/PlayerBadgeUtils.ts` -> `src/shared/utils/PlayerBadgeUtils.ts`
- `src/utils/RelayConnection.ts` -> `src/network/transport/RelayConnection.ts`
- `src/utils/SoundSynth.ts` -> `src/media/audio/SoundSynth.ts`
- `src/utils/VirtualJoystick.ts` -> `src/input/controllers/VirtualJoystick.ts`
- `src/utils/UITheme.ts` -> `src/ui/shared/UITheme.ts`
- `src/utils/canvasui/*` -> `src/ui/shared/canvasui/*`

### Network

- `src/network/NetworkManager.ts` -> `src/network/transport/NetworkRuntime.ts`
- `src/network/NetworkDispatcher.ts` -> `src/network/protocol/PacketDispatcher.ts`
- `src/network/NetworkSynchronizer.ts` -> `src/network/replication/StateSynchronizer.ts`
- `src/network/NetworkTypes.ts` -> `src/network/protocol/PacketTypes.ts`
- `src/network/NetworkGuards.ts` -> `src/network/protocol/PacketGuards.ts`
- `src/network/PacketHandler.ts` -> `src/network/protocol/PacketHandler.ts`
- `src/managers/ReplicationManager.ts` -> `src/network/replication/FeatureReplicationService.ts`

### World

- `src/managers/SessionManager.ts` -> `src/world/session/SessionRuntime.ts`
- `src/managers/EntityManager.ts` -> `src/world/entities/EntityRegistry.ts`
- `src/managers/PlayerManager.ts` -> `src/world/session/PlayerPresenceService.ts`
- `src/factories/EntityFactory.ts` -> `src/world/spawning/EntityFactory.ts`

### Entities

- `src/entities/*` -> `src/world/entities/*`

Entity naming candidates for later cleanup:

- `LocalPlayer.ts` -> `LocalPlayerEntity.ts`
- `RemotePlayer.ts` -> `RemotePlayerEntity.ts`
- `PlayerEntity.ts` -> review for overlap; likely merge or rename after audit
- `NetworkEntity.ts` -> review for overlap; likely rename based on actual role

These should not all be auto-renamed in the first pass until their responsibilities are clarified.

### Features

- `src/managers/DrawingManager.ts` -> `src/features/drawing/DrawingFeature.ts`
- `src/managers/SocialEffectsManager.ts` -> `src/features/social/SocialFeature.ts`
- `src/managers/RemoteDesktopManager.ts` -> `src/features/remoteDesktop/RemoteDesktopFeature.ts`

### Input

- `src/input/InputManager.ts` -> `src/input/controllers/InputRuntime.ts`
- `src/input/XRInputManager.ts` -> `src/input/controllers/XRInputController.ts`
- `src/input/NonVRInteractionController.ts` -> `src/input/controllers/DesktopInteractionController.ts`
- `src/input/NonVRReachAssistController.ts` -> `src/input/controllers/DesktopReachAssistController.ts`
- `src/input/KeyboardManager.ts` -> `src/input/controllers/KeyboardController.ts`
- `src/input/GamepadManager.ts` -> `src/input/controllers/GamepadController.ts`
- `src/input/MobileJoystickManager.ts` -> `src/input/controllers/MobileJoystickController.ts`
- `src/input/XRTrackingProvider.ts` -> `src/input/providers/XRTrackingProvider.ts`
- `src/input/DesktopTrackingProvider.ts` -> `src/input/providers/DesktopTrackingProvider.ts`
- `src/managers/TrackingManager.ts` -> `src/input/providers/TrackingRuntime.ts`

### Physics

- `src/managers/PhysicsManager.ts` -> `src/physics/runtime/PhysicsRuntime.ts`
- `src/systems/PhysicsPresentationSystem.ts` -> `src/physics/systems/PhysicsPresentationSystem.ts`

### Render

- `src/managers/RenderManager.ts` -> `src/render/runtime/RenderRuntime.ts`
- `src/managers/ParticleSystemManager.ts` -> `src/render/effects/ParticleEffectSystem.ts`
- `src/managers/DebugRenderManager.ts` -> `src/render/debug/DebugRenderRuntime.ts`
- `src/views/*` -> `src/render/views/*`
- `src/views/avatar/components/*` -> `src/render/avatar/components/*`
- `src/views/avatar/stickfigure/*` -> `src/render/avatar/stickfigure/*`

### UI

- `src/managers/FlatUIManager.ts` -> `src/ui/flat/FlatUiRuntime.ts`
- `src/managers/VRUIManager.ts` -> `src/ui/vr/VrUiRuntime.ts`
- `src/managers/HUDManager.ts` -> `src/ui/hud/HudRuntime.ts`

### Media

- `src/managers/MediaManager.ts` -> `src/media/voice/VoiceRuntime.ts`
- `src/managers/AudioManager.ts` -> `src/media/audio/AudioRuntime.ts`

### Assets

- `src/managers/AssetManager.ts` -> `src/assets/runtime/AssetRuntime.ts`
- `src/managers/EnvironmentManager.ts` -> `src/assets/procedural/EnvironmentBuilder.ts`
- `src/managers/PropManager.ts` -> `src/assets/procedural/PropBuilder.ts`

### Systems

These remain systems, but they should move closer to the domain they serve.

- `src/systems/InteractionSystem.ts` -> `src/world/systems/InteractionSystem.ts`
- `src/systems/AnimationSystem.ts` -> `src/render/systems/AnimationSystem.ts`

### Server

The browser client source and server source should be separated more explicitly.

- `server.ts` -> keep at root for now or move later to `server/server.ts`
- `src/server/ServerNetworkManager.ts` -> `src/server/network/ServerNetworkRuntime.ts`
- `src/server/HeadlessRoom.ts` -> `src/server/session/HeadlessRoom.ts`

The `src/server/` subtree can be refactored in a second pass because it is not part of the browser bundle layout.

## What Changes In Phase 1

Phase 1 should be mechanical and low risk.

- Move files into the target domain folders.
- Rename files and exported symbols where confidence is high.
- Rewrite import paths.
- Preserve existing behavior.
- Avoid splitting large classes unless necessary to keep the move working.

## What Does Not Change In Phase 1

- No major runtime rewrites.
- No deep feature redesign.
- No aggressive entity hierarchy cleanup.
- No new plugin/mod loader yet.
- No protocol redesign unless required by path/symbol changes.

## Known Ambiguities To Resolve Before Aggressive Renames

These need explicit review before a broad symbol rename:

- `PlayerEntity` vs `LocalPlayer` vs `RemotePlayer`
- `NetworkEntity`
- Whether `DrawingManager` is truly a feature entry point or should be split into feature + render helper
- Whether `MediaManager` should remain a voice transport runtime versus a wider media domain runtime
- Whether `SessionManager` should later split into `SessionRuntime` and `LevelRuntime`

## Recommended Migration Sequence

1. Freeze the target taxonomy in this document.
2. Build a file move map from current paths to target paths.
3. Apply only high-confidence file moves first.
4. Apply high-confidence exported symbol renames.
5. Rewrite imports automatically.
6. Run build and tests.
7. Audit the ambiguous classes and perform second-pass decomposition.

## Decision Standard

During the refactor, choose the option that makes a module's role obvious to a new contributor from:

- its path
- its filename
- its exported symbol

If those three do not align, the naming is still not good enough.
