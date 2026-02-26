### My TODO notes:

- Add a good debug visualization layer for physics and networking: should be optional to enable; show current ownership of objects as label; show collision shapes and maybe also velocity vectors
- We need an in VR UI layer (perhaps a hand menu) where skills and features can be present and switched and that also acts as control panel for complex features
- Make the room more dynamic and interesting; 
   - a simple idea would be a sign with the room name and maybe player count? But we need a good structure to handle all this meta data to not make a mess of the codebase
   - buttons that do fun stuff?
- Improve the drawing feature (late joiners don't see the drawing; ability to delete?)

Future:
- Connect WebXR full body tracking;
- Whiteboard prop?
- Solve screensharing (maybe local only for now and have an extra /screenshare route on the webserver that relays the stream)


### Future Architectural Roadmap & Next Major Refactoring Steps

3. **Modularizing Remaining "God-Class" Managers**
   * **Goal:** Ensure all systems follow the Single Responsibility Principle, making them vastly easier to mentally parse and adapt.
   * **Action:** Break down large managers (like `NetworkManager` and `RoomManager`). For instance, `NetworkManager` currently handles WebRTC setup, data relays, synchronization loops, and ownership rules simultaneously. These should become isolated, injected services (e.g., `OwnershipService`, `SyncService`, `PeerConnectionService`).
   * **Benefit:** Adding a feature like "Team Ownership" logic only requires developer context inside a 50-line `OwnershipService`, preventing the risk of accidentally breaking the core connection logic.

4. **Enhance Entity Capabilities through Composition (Mixins/Interfaces)**
   * **Goal:** Prevent massive, bloated base classes (`NetworkEntity`, `PlayerEntity`) while sticking to OOP.
   * **Action:** Instead of deep inheritance trees, use Interfaces (`IInteractable`, `IGrabbable`) and potentially Mixins or discrete logic components (like `MovementSkill` or `GrabSkill`) instantiated within the Entity.
   * **Benefit:** You can create a new entity (like a physical bouncing ball) that simply implements `IGrabbable` without needing to inherit from a huge generic base class that includes irrelevant logic.
