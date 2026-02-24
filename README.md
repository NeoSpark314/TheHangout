# TheHangout

A multiplayer WebXR social space — hang out with friends in VR or on desktop, right from the browser.

## Quick Start

```bash
npm install
npm run dev          # Development (Vite + PeerJS cloud)
```

### Local Server (LAN & Corporate hosting)

```bash
npm run build        # Build the client
npm run serve        # Start Express + local PeerJS signaling + WS Relay (port 443)
```

Opens at `https://localhost/`. Self-signed SSL cert is auto-generated on first run.

## Architecture

The project follows a **Clean Architecture** pattern designed for high-performance spatial synchronization.

| Layer | Tech | Role |
|-------|------|------|
| **Core** | TypeScript | Game loop, Event Bus, Type-safe Global State. |
| **Logic Entities** | Custom | "Source of Truth" for state (Physics, Networking, Poses). |
| **Managers** | Custom | Lifecycle and orchestration (Network, Render, Physics). |
| **Systems** | Custom | Specialized logic (XR Math, Interaction). |
| **Views** | Three.js | Purely visual representation of entities. |

### Engineering Principles

1.  **Single Source of Truth**: Entities (like `LocalPlayer` or `PhysicsEntity`) own their logic and spatial state. The Rendering layer only *follows* or *represents* this state.
2.  **Decoupling**: Logic entities communicate via events (`EventBus`) for networking and interaction, rather than calling managers directly.
3.  **Spatial Math**: Using **THREE.js** for spatial math (Vectors, Quaternions, Matrices) is encouraged and standardized across the codebase, but THREE.js *Objects* (Meshes, Groups) should remain confined to the View layer.
4.  **Type Safety**: Manager access is strictly typed through `gameState.managers` to eliminate `any` casting and circular dependencies.

## Core Systems

### Entity & View System
All synced game objects follow the **Decoupled Entity Pattern**:
- **Entities** (`src/entities/`): Logic-only. They calculate physics, handle ownership, and maintain poses.
- **Views** (`src/views/`): Three.js visual implementations. They receive state updates from entities and update the scene.
- **XRSystem** (`src/systems/`): Centralized math hub for transforming raw WebXR data into avatar-relative space.

### Camera & Possession
The **RenderManager** acts as a "Follower." It does not move the player; instead, it observes the player currently assigned to `gameState.localPlayer` and syncs the Three.js camera to match the entity's head pose and origin.

## Controls

### VR Mode
- **Movement**: Left Thumbstick (Head-relative)
- **Rotation**: Right Thumbstick (Snap Turn)
- **Grab**: Grip button (hold to carry)
- **Voice**: Microphone active by default (toggle via UI)

### Desktop Mode
- **Movement**: WASD
- **Look**: Mouse (Pointer Lock)
- **Grab**: **E key** (hold to carry, release to throw)
- **Voice**: Microphone toggle via UI button

## Project Structure

```
├── index.html          # Entry HTML
├── src/
│   ├── core/           # GameEngine, EventBus, Type-safe GameState
│   ├── entities/       # State Owners: LocalPlayer, RemotePlayer, PhysicsEntity
│   ├── factories/      # Creation logic & wiring
│   ├── interfaces/     # Strict decoupling definitions (IEntity, IView, IInteractable)
│   ├── managers/       # Orchestrators: Render, Network, Physics, Player, UI
│   ├── systems/        # Logic Hubs: XRSystem, InteractionSystem
│   ├── views/          # Visuals: StickFigureView, PhysicsPropView
│   └── utils/          # Math, Constants, Network Relays
└── vite.config.js
```
