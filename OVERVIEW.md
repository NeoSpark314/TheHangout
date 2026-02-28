# Overview of The Hangout
This overview is intended to give a high-level overview of the project architecture and design decisions mostly for coding agents to get a quick grasp of where everything is and how it works.

## Architecture

The project follows a **Clean Object-Oriented (OOP) Architecture** pattern based on a robust Entity Class Hierarchy. It is designed for high-performance spatial synchronization and modular gameplay features while remaining approachable and easy to maintain without the complexity of an ECS.

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
3.  **World-Space Uniformity**: All spatial data (Joints, Head, Hands) is processed and synchronized in **World Space**. Coordinates are only transformed into local space at the final rendering step within the `View` layer. This "Standardized World" approach eliminates double-transformation bugs, simplifies network synchronization, and ensures frame-perfect parity between local and remote representations.
4.  **Capability-Based Interaction**: Interaction is defined by interfaces (`IInteractable`, `IGrabbable`). Logic systems safely query these capabilities at runtime.
5.  **Strictly Typed Network Contract**: All traffic utilizes explicitly typed packet payloads (`INetworkPacket.ts`) and Discriminated Unions (`IEntityState.ts`). We use a compact wire format (tuples and abbreviated keys) to minimize bandwidth. 
6.  **Type-Safe Network Hydration**: To manage bandwidth, network payloads are often minified and partial (e.g., `INetworkHandState`). We avoid using `any` during deserialization. Instead, incoming partial network interfaces are strictly defined and safely merged into robust local Class Models (e.g., `HandState.applyData()`) to prevent `undefined` runtime crashes and guarantee valid state.
7.  **Data-Oriented Math Types (Interfaces vs. Classes)**: For fundamental spatial data (`IPose`, `IVector3`, `IQuaternion`), the architecture strictly uses **Interfaces** rather than Classes with helper methods. This provides three critical benefits:
    *   **Zero Allocation Overhead**: In a 90hz VR render loop, instantiating millions of `new Pose()` class objects would thrash the Garbage Collector and cause frame drops. Interfaces are zero-cost at runtime.
    *   **Frictionless Serialization**: Raw JSON from the network (`{ position: {...}, quaternion: {...} }`) can be cast directly to `IPose` without needing to iterate and manually instantiate class instances.
    *   **Duck-Typing Interoperability**: Because the interfaces only define data shape (`x, y, z`), objects from other libraries (like `THREE.Vector3` or WebXR's `XRRigidTransform`) often automatically fulfill the contract without expensive conversions.
8.  **Linear Lifecycle**: The `App` class enforces a strict, promise-based initialization bootstrap: **Infrastructure -> World -> Engine**.

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

## Project Structure

```
├── src/
│   ├── core/           # App, GameEngine, EventBus, GameContext
│   ├── entities/       # Logic Owners: LocalPlayer, PhysicsEntity, PenEntity, TabletEntity
│   ├── factories/      # Object creation: EntityFactory
│   ├── input/          # Hardware Input Layers: Keyboard, Gamepad, XR, Joystick
│   ├── interfaces/     # Strict Contracts: IUpdatable, IEntity, IView, IEntityState, IPose
│   ├── managers/       # Orchestrators: Render, Network, Physics, Assets, VRUI
│   ├── models/         # Pure Data Models: HandState
│   ├── network/        # Messaging: Dispatcher, Synchronizer, PacketHandlers
│   ├── server/         # Tiny local Node/Bun relay server scripts
│   ├── skills/         # Action logic modules: MovementSkill, GrabSkill, UIPointerSkill
│   ├── systems/        # Logic Hubs: InteractionSystem, AnimationSystem
│   ├── views/          # Three.js Visuals: StickFigureView, PhysicsPropView, CanvasUI
│   └── utils/          # Math, Constants, GestureUtils
└── vite.config.ts
```
