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

1.  **Dependency Injection (DI)**: Core context (`GameContext`) is explicitly passed via constructors. No hidden global singletons, making dependencies obvious and easily testable.
2.  **Open/Closed Game Loop**: The `GameEngine` iterates over an array of dynamically injected `IUpdatable` systems. New managers or mechanics can be slotted into the frame loop without altering the engine code.
3.  **Single Source of Truth**: Entities (like `LocalPlayer` or `PhysicsEntity`) drive the mechanics. The Rendering layer only *follows* or *interpolates* this state via distinct `EntityView` instances.
4.  **Domain-Driven Synchronization**: Networking is a pure transport. Entities handle their own specialized events to encapsulate internal state changes.
5.  **Capability-Based Interaction**: Interaction is defined by interfaces (`IInteractable`, `IGrabbable`). Logic systems safely query these capabilities at runtime.
6.  **Strictly Typed Network Contract**: All traffic utilizes explicitly typed packet payloads (`INetworkPacket.ts`) and Discriminated Unions (`IEntityState.ts`). We use a compact wire format (tuples and abbreviated keys) to minimize bandwidth.
7.  **Linear Lifecycle**: The `App` class enforces a strict, promise-based initialization bootstrap: **Infrastructure -> World -> Engine**.

## Core Systems

### App Orchestrator
The `App` class manages the startup sequence, ensuring all managers are registered and systems are initialized in the correct order to prevent race conditions.

### Entity & View System
- **Entities**: Logic-only state owners.
- **Views**: Visual-only representations with a managed Three.js lifecycle.
- **EntityFactory**: Data-driven spawning using the `EntityType` registry.

### Modular Networking
- **Transport**: Raw communication via PeerJS/Sockets or local WebSocket Relay.
- **Dispatcher**: Routes incoming packets to specific `PacketHandlers`.
- **Synchronizer**: A 20Hz loop that broadcasts authoritative entity states using standardized, bandwidth-efficient interfaces.

## Controls

### VR Mode
- **Movement**: Left Thumbstick
- **Rotation**: Right Thumbstick (Snap Turn)
- **Grab**: Grip button (Proximity-based)
- **Interact**: Index Trigger
- **Voice**: Microphone active by default

### Desktop Mode
- **Movement**: WASD
- **Look**: Mouse (Pointer Lock)
- **Grab/Interact**: *[Experimental]* Raycast interaction is currently disabled. Proximity interaction only.
- **Voice**: Microphone toggle via UI button

## Project Structure

```
├── src/
│   ├── core/           # App, GameEngine, EventBus, GameContext
│   ├── entities/       # State Owners: LocalPlayer, PhysicsEntity, PenEntity
│   ├── interfaces/     # Strict Contracts: IUpdatable, IEntity, IView, IEntityState, INetworkPacket
│   ├── managers/       # Orchestrators: Render, Network, Physics, Assets, Drawing
│   ├── network/        # Messaging: Dispatcher, Synchronizer, PacketHandlers
│   ├── input/          # Hardware Input Layers: Keyboard, Gamepad, XR, Joystick
│   ├── systems/        # Logic Hubs: XRSystem, InteractionSystem
│   ├── views/          # Visuals: StickFigureView, PhysicsPropView, PenView
│   └── utils/          # Math, Constants, HostKeepalive
└── vite.config.js
```
