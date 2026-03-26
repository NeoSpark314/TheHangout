# The Opinionated Collab Engine Philosophy

To ensure all scenarios feel consistently grounded, cooperative, and interactive, this engine is strictly organized around **9 Core Pillars**. This philosophical model drives where code lives and what dependencies are allowed.

Companion docs:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [GAMEPLAY_API.md](./GAMEPLAY_API.md)
- [SCENARIO_API.md](./SCENARIO_API.md)
- [REPLICATION.md](./REPLICATION.md)

## Core Meta-Principle: VR-First Spatial Design
The Hangout is built from the ground up to be a **Virtual Reality first** experience. All underlying interactions, UI elements, and gameplay mechanics must assume a fully spatial 3D environment with 6DoF tracked controllers and full physical agency. 

Desktop and mobile interfaces are treated strictly as flat-screen simulators of this spatial presence. They emulate the 3D reality, rather than forcing the 3D reality to compromise for 2D interfaces.

## The Foundation (Engine Core)
The absolute base layer that simulates the universe. These modules have no knowledge of gameplay or user interfaces.
1. **Rendering:** Makes the universe *visible* (Three.js, meshes, particles, skeletons).
2. **Media/Audio:** Makes the universe *audible* (Spatial SFX, voice compression, audio graphs).
3. **Physics:** Makes the universe *believable* (Collisions, gravity, authoritative handoffs).
4. **Network:** The *fabric* that connects the group (Tick-sync, semantic replication, peer-to-peer transport).
5. **Input & Locomotion:** Translates the physical human into the digital space (VR tracking matrices, WASD movements, raycasting).

## The Collaborative Overlay (Persistent Layers)
The systems that govern the "Session" and the "Users" regardless of what world they teleport to. 
6. **Features:** The overarching *experience* tools and their respective User Interfaces (UI).
   - *Concept:* Features are high-level functionalities accessible at any time. Because a Feature completely "owns" its interface, its UI code is bundled directly with its core mechanics rather than being scattered across the engine.
   - *Current Examples:* `RemoteDesktopFeature` (screen sharing), `SocialFeature` (player lists/avatars), `NotificationRuntime` (toast popups).
   - *Rule:* Features can overlay any Scenario. To integrate cleanly, they must use generic routers such as `getFeatureLayout(...)` to determine where their 3D UI should be placed. If a scenario doesn't provide a specific layout, the Feature provides its own default fallback.
   - *Boundary:* Shared UI primitives and runtimes can still live under `ui/`, but feature-specific UI behavior should stay with the feature.

7. **Skills:** The *verbs*. What every participant is inherently capable of doing in the 3D world.
   - *Examples:* Grabbing/Interacting, Drawing (spawning ink), Mounting/Sitting, Throwing.
   - *Rule:* A player shouldn't forget how to "Grab" just because they entered a new Scenario. Skills evaluate input and manipulate Objects.

## The Content (Stateful Instances)
The variable pieces of content that are loaded, spawned, and destroyed.
8. **Objects:** The *nouns*. Reusable items that players can interact with.
   - *Examples:* `PewPewGunObject`, `PenToolEntity`, `GrabbableCubeObject`, `ChairObject`.
   - *Rule:* Objects encapsulate their own physics colliders and visual representations. They do not dictate *how* a player grabs them; they simply react to the interaction events emitted by the player's Skills.

9. **Scenarios:** The *places*. The specific domains the group can travel to.
   - *Examples:* `default-hangout` (the boardroom), `simple-racing` (the track), `target-toss`.
   - *Rule:* Scenarios define the environment geometry, the spawn coordinates, and the overarching "Rules of the Game". They orchestrate the initial spawning of Objects but do **not** define how players natively move or interact.
