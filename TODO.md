### Architectural & Maintenance TODOs (COMPLETED)

* [x] **Implement Dependency Injection (DI)** * Replaced the global `gameState` singleton in `GameState.ts` with a DI approach (`GameContext`).
* [x] Passed dependencies explicitly through constructors so class requirements are immediately visible.


* [x] **Refactor the Game Loop for Extensibility** * Removed the hardcoded manager checks inside the `update` loop of `GameEngine.ts`.
* [x] Introduced an `IUpdatable` interface and dynamically register systems so the engine conforms to the Open/Closed Principle.


* [x] **Enforce Strict Typing and Encapsulation**
* [x] Audited and removed `any` casting associated with network payloads (`NetworkManager`, `NetworkDispatcher`).
* [x] Expose proper public methods or getters/setters to handle cross-system data access safely.


* [x] **Deconstruct the Input Manager**
* [x] Split the overly complex `InputManager.ts` into distinct, single-responsibility layers (KeyboardManager, GamepadManager, MobileJoystickManager, XRInputManager).
* [x] Separated raw hardware polling (Gamepad, XR, DOM), semantic action mapping (gameplay intents), and UI navigation logic (CSS manipulation).


* [x] **Fix Initialization Control Flow**
* [x] Removed reliance on the global `EventBus.ts` for linear startup sequences like triggering `SCENE_READY` inside GameEngine.
* [x] Using explicit Promises, `await`, or direct method calls to handle application bootstrapping predicting in `App.ts`.


* [x] **Establish Code Documentation Standards**
* [x] Added reasonable, consistent Code Documentation (JSDoc) across core architectural classes to ensure approaching future maintainers is simple.

---

### Future Architectural Roadmap & Next Major Refactoring Steps

To achieve the ultimate goal of easily extending and developing individual parts without needing to understand or touch unrelated code, these subsequent architectural paradigms should be pursued:

1. **Extract Rendering Engine (Three.js) Behind an Abstract Interface**
   * **Goal:** Completely decouple the core game logic from `Three.js`. 
   * **Action:** Instead of entities or managers directly importing and instantiating `THREE.Mesh` or `THREE.Group`, define an abstract rendering bridge (e.g., `IRenderer`, `IMesh`). A concrete `ThreeRenderer` implementation would handle the WebGL specifics.
   * **Benefit:** This strictly stops visual logic from intertwining with gameplay code. It enables running headless servers (Node.js) without needing to mock DOM or Three.js objects cleanly, and theoretically allows swapping rendering engines (e.g., transitioning to Babylon.js) with zero changes to gameplay rules.

2. **Transition to an Entity Component System (ECS) Architecture**
   * **Goal:** Move away from deep, rigid class inheritance hierarchies (`Entity -> NetworkEntity -> PlayerEntity -> LocalPlayer`).
   * **Action:** Refactor `EntityManager` logic into an ECS model. Entities become pure ID numbers. Behaviors and rules are refactored into modular Data Components (`Renderable`, `PhysicsBody`, `NetworkSynchronized`, `PlayerInput`) and pure logic Systems (`PhysicsSystem`, `DrawingSystem`).
   * **Benefit:** Exponentially easier to prototype and add new items or mechanics safely. Creating a completely new object like a "flying, networked laser" simply requires attaching the `Physics`, `Network`, and `Laser` components to an ID, avoiding the need to inherit from massive base classes or duplicate functionality. 

3. **Event-Driven Gameplay Logic vs. Direct Input Polling**
   * **Goal:** While the `InputManager` is now separated into hardware concerns, core code still directly calls `input.getMovementVector()`.
   * **Action:** Shift the input layers to fire semantic intent commands (`ACTION_JUMP`, `INTENT_MOVE_FORWARD`) via an Input Command Queue. Game logic systems process these abstract intents rather than querying a manager for hardware-specific state.
   * **Benefit:** Game rules no longer care *how* a move happens. It means implementing new hardware (e.g., eye-tracking interactions or AI-driven bots) requires zero adaptation in the core gameplay components.

4. **Modularizing Remaining "God-Class" Managers**
   * **Goal:** Ensure all managers follow the Single Responsibility Principle, making them vastly easier to mentally parse and adapt.
   * **Action:** Break down large managers (like `NetworkManager` and `RoomManager`). For instance, `NetworkManager` still handles setup, relay handling, state sync loops, and ownership arbitration. These should become isolated injected services (`OwnershipService`, `RelayService`).
   * **Benefit:** Adding a feature like "Team Ownership" logic only requires developer context inside a 50-line `OwnershipService`, rather than forcing them to reason around a massive 400-line routing file. This guarantees safe isolation.
