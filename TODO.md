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
