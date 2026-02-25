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

To achieve the ultimate goal of easily extending and developing individual parts without needing to understand or touch unrelated code, we are committing to our **Object-Oriented (OOP) Entity Class Hierarchy**. The next steps focus on solidifying this architecture through rigorous consistency and modularity:

1. **Standardize Naming Conventions & Codebase Cleanup**
   * **Goal:** Ensure perfect consistency across all files, classes, and variables so developers immediately know what a piece of code does by its name.
   * **Action:** Audit the entire codebase. Ensure all interfaces start with `I` (e.g., `IGrabbable`), all boolean flags are predictably named (`isReady`, `hasAuthority`), and folder structures strictly align with their contents (e.g., no loose logic files outside of `skills/`, `systems/`, or `managers/`). Standardize event names and payload structures.

2. **Event-Driven Gameplay Logic vs. Direct Input Polling**
   * **Goal:** Decouple the origin of player intent from the execution of the mechanic.
   * **Action:** Shift the input layers to fire semantic intent commands (e.g., `ACTION_JUMP`, `INTENT_MOVE_FORWARD`) via an Input Command Queue. Game logic systems process these abstract intents rather than polling a specific `InputManager.gamepad`.
   * **Benefit:** Game rules no longer care *how* an action was triggered. Implementing a new input method (like eye-tracking interactions or AI-driven companions) requires absolutely zero changes in the gameplay execution code.

3. **Modularizing Remaining "God-Class" Managers**
   * **Goal:** Ensure all systems follow the Single Responsibility Principle, making them vastly easier to mentally parse and adapt.
   * **Action:** Break down large managers (like `NetworkManager` and `RoomManager`). For instance, `NetworkManager` currently handles WebRTC setup, data relays, synchronization loops, and ownership rules simultaneously. These should become isolated, injected services (e.g., `OwnershipService`, `SyncService`, `PeerConnectionService`).
   * **Benefit:** Adding a feature like "Team Ownership" logic only requires developer context inside a 50-line `OwnershipService`, preventing the risk of accidentally breaking the core connection logic.

4. **Enhance Entity Capabilities through Composition (Mixins/Interfaces)**
   * **Goal:** Prevent massive, bloated base classes (`NetworkEntity`, `PlayerEntity`) while sticking to OOP.
   * **Action:** Instead of deep inheritance trees, use Interfaces (`IInteractable`, `IGrabbable`) and potentially Mixins or discrete logic components (like `MovementSkill` or `GrabSkill`) instantiated within the Entity.
   * **Benefit:** You can create a new entity (like a physical bouncing ball) that simply implements `IGrabbable` without needing to inherit from a huge generic base class that includes irrelevant logic.
