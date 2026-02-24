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
| **Core** | TypeScript | App Orchestration, Game loop, Event Bus, Type-safe Global State. |
| **Logic Entities** | Custom | "Source of Truth" for state (Physics, Networking, Poses). |
| **Managers** | Custom | Lifecycle and orchestration (Network, Render, Physics). |
| **Systems** | Custom | Logic Hubs (XR Math, Interaction). |
| **Views** | Three.js | Purely visual representation of entities. |

### Engineering Principles

1.  **Single Source of Truth**: Entities (like `LocalPlayer` or `PhysicsEntity`) own their logic and spatial state. The Rendering layer only *follows* or *represents* this state.
2.  **Decoupling**: Logic entities communicate via events (`EventBus`) for networking and interaction. Skills receive dependencies via a modular interface rather than polling global state.
3.  **Spatial Math**: Using **THREE.js** for spatial math (Vectors, Quaternions, Matrices) is encouraged, but THREE.js *Objects* (Meshes, Groups) remain confined to the View layer.
4.  **Type Safety**: Manager access is strictly typed through `gameState.managers` to eliminate circular dependencies.

## Core Systems

### App Orchestrator
The `App` class (`src/core/App.ts`) manages the entire lifecycle of the application, from server detection and manager initialization to system startup. `main.ts` remains a minimal entry point.

### Entity & View System
All synced game objects follow the **Decoupled Entity Pattern**:
- **Entities**: Logic-only. They calculate physics, handle ownership, and maintain poses.
- **Views**: Three.js visual implementations. They receive state updates and update the scene.
- **XRSystem**: Centralized math hub for transforming raw WebXR data into avatar-relative space.

### Networking (Dispatcher/Synchronizer)
Networking is split into three concerns:
- **Transport**: Raw PeerJS/Socket communication.
- **Dispatcher**: Routes incoming packets to specialized `PacketHandlers`.
- **Synchronizer**: Manages the 20Hz heartbeat loop for authoritative state syncing.

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
│   ├── core/           # App, GameEngine, EventBus, GameState
│   ├── entities/       # State Owners: LocalPlayer, RemotePlayer, PhysicsEntity
│   ├── interfaces/     # Decoupling definitions (IEntity, IView, IInteractable)
│   ├── managers/       # Orchestrators: Render, Network, Physics, Player, UI
│   ├── network/        # Networking: Dispatcher, Synchronizer, PacketHandlers
│   ├── skills/         # Gameplay: Movement, Grab (Modular interface)
│   ├── systems/        # Logic Hubs: XRSystem, InteractionSystem
│   ├── views/          # Visuals: StickFigureView, PhysicsPropView
│   └── utils/          # Math, Constants, Network Relays
└── vite.config.js
```
