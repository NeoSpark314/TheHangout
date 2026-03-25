# The Opinionated Collab Engine Philosophy

To ensure all scenarios feel consistently grounded, cooperative, and interactive, this engine is strictly organized around **9 Core Pillars**. This philosophical model drives where code lives and what dependencies are allowed.

## The Foundation (Engine Core)
The absolute base layer that simulates the universe. These modules have no knowledge of gameplay or user interfaces.
1. **Rendering:** Makes the universe *visible* (Three.js, meshes, particles, skeletons).
2. **Media/Audio:** Makes the universe *audible* (Spatial SFX, voice compression, audio graphs).
3. **Physics:** Makes the universe *believable* (Collisions, gravity, authoritative handoffs).
4. **Network:** The *fabric* that connects the group (Tick-sync, semantic replication, peer-to-peer transport).
5. **Input & Locomotion:** Translates the physical human into the digital space (VR tracking matrices, WASD movements, raycasting).

## The Collaborative Overlay (Persistent Layers)
The systems that govern the "Session" and the "Users" regardless of what world they teleport to. 
6. **Features:** Defines the overarching *experience* and interface.
   - *Examples:* Remote Desktop Sharing, Social Voiceline UI, Notification popups, the universal Main Menu.
   - *Rule:* Features can overlay any Scenario. They must use generic routers (like `getFeatureLayout`) rather than imposing their physical existence on simple worlds.

7. **Skills:** The *verbs*. What every participant is inherently capable of doing in the 3D world.
   - *Examples:* Grabbing/Interacting, Drawing (spawning ink), Mounting/Sitting, Throwing.
   - *Rule:* A player shouldn't forget how to "Grab" just because they entered a new Scenario. Skills evaluate input and manipulate Objects.

## The Content (Stateful Instances)
The variable pieces of content that are loaded, spawned, and destroyed.
8. **Objects:** The *nouns*. Reusable things people can use, hold, or play with.
   - *Examples:* The Laser Gun, the Pen Tool, a Grabbable Cube, a Drum Pad.
   - *Rule:* Objects encapsulate their own physics colliders and visual representations. They are manipulated by Skills.

9. **Scenarios:** The *places*. The specific domains the group can travel to.
   - *Examples:* The specific Cyberstube Boardroom, the Target Toss Arena.
   - *Rule:* Scenarios define the environment visuals, the spawn coordinates, and the "Rules of the Game". They orchestrate the initial spawning of Objects but do **not** define how players move or interact.
