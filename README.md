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

The project follows a **Clean Architecture** pattern designed for high-performance spatial synchronization and modular gameplay features.

| Layer | Tech | Role |
|-------|------|------|
| **Core** | TypeScript | App Orchestration (`App`), Game loop (`GameEngine`), Event Bus, Type-safe Global State. |
| **Logic Entities** | Custom | "Source of Truth" for state. They own logic, physics modes, and poses. |
| **Managers** | Custom | Lifecycle and orchestration (Network, Render, Physics, Assets). |
| **Systems** | Custom | Logic Hubs (XR Math, Interaction, Drawing). |
| **Views** | Three.js | Purely visual representation of entities. No business logic here. |

### Engineering Principles

1.  **Single Source of Truth**: Entities (like `LocalPlayer` or `PhysicsEntity`) drive the visuals. The Rendering layer only *follows* or *interpolates* this state.
2.  **Domain-Driven Synchronization**: Networking is a pure transport. Entities handle their own specialized events (e.g., `OWNERSHIP_RELEASE`) to encapsulate internal state changes (like rigid body mode transitions).
3.  **Capability-Based Interaction**: Interaction is defined by interfaces (`IInteractable`, `IGrabbable`). Skills interact with these capabilities rather than specific classes, allowing for diverse objects (Physics Cubes, non-physics Pens, UI Buttons).
4.  **Strictly Typed Network Contract**: All network traffic follows explicit interfaces in `IEntityState.ts` to prevent key mismatches and ensure type safety across the network boundary.
5.  **Linear Lifecycle**: The `App` class enforces a strict initialization sequence: **Infrastructure (Physics) -> World (Room/Props) -> Engine (Loop)**.

## Core Systems

### App Orchestrator
The `App` class manages the startup sequence, ensuring all managers are registered and systems are initialized in the correct order to prevent race conditions.

### Entity & View System
- **Entities**: Logic-only. They implement capabilities like `IGrabbable`.
- **Views**: Visual-only. They implement `IView` and handle Three.js scene management and materials.
- **EntityFactory**: A registry-based system for spawning entities by type string, making world population data-driven.

### Modular Networking
- **Transport**: Raw communication via PeerJS/Sockets.
- **Dispatcher**: Routes incoming packets to specific `PacketHandlers`.
- **Synchronizer**: A 20Hz loop that collects and broadcasts authoritative entity states using standardized interfaces.

## Controls

### VR Mode
- **Movement**: Left Thumbstick (Head-relative)
- **Rotation**: Right Thumbstick (Snap Turn)
- **Grab**: Grip button (hold to carry)
- **Interact**: Index Trigger (Analog pressure supported for tools like Pens)
- **Voice**: Microphone active by default (toggle via UI)

### Desktop Mode
- **Movement**: WASD
- **Look**: Mouse (Pointer Lock)
- **Grab**: **E key** (hold to carry, release to throw)
- **Interact**: **Left Mouse Click** (while holding)
- **Voice**: Microphone toggle via UI button

## Project Structure

```
├── src/
│   ├── core/           # App, GameEngine, EventBus, GameState
│   ├── entities/       # State Owners: LocalPlayer, PhysicsEntity, PenEntity
│   ├── interfaces/     # Strict Contracts: IEntity, IView, IGrabbable, IEntityState
│   ├── managers/       # Orchestrators: Render, Network, Physics, Assets, Drawing
│   ├── network/        # Messaging: Dispatcher, Synchronizer, PacketHandlers
│   ├── skills/         # Gameplay Logic: Movement, Grab
│   ├── systems/        # Logic Hubs: XRSystem, InteractionSystem
│   ├── views/          # Visuals: StickFigureView, PhysicsPropView, PenView
│   └── utils/          # Math, Constants, DeviceUtils
└── vite.config.js
```
