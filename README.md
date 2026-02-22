# TheHangout

A multiplayer WebXR social space — hang out with friends in VR or on desktop, right from the browser.

## Quick Start

```bash
npm install
npm run dev          # Development (Vite + PeerJS cloud)
```

### Local Server (LAN hosting)

```bash
npm run build        # Build the client
npm run serve        # Start Express + local PeerJS signaling (port 443)
```

Opens at `https://localhost/`. Self-signed SSL cert is auto-generated on first run.

**Options** (CLI flags or env vars):
```bash
npm run serve -- --port 8443                      # Custom port
npm run serve -- --key ./my.key --cert ./my.cert  # Custom SSL cert
```

## Architecture

| Layer | Tech | Notes |
|-------|------|-------|
| Rendering | Three.js | Scene, camera, XR session |
| Physics | Rapier (WASM) | Rigid bodies, collision |
| Networking | PeerJS (WebRTC) | P2P data + voice |
| VR | WebXR | Hand tracking, head pose |
| Server | Express + PeerJS Server | Optional local signaling |

### Entity System

All synced game objects follow the **Unified Entity Pattern** (see `NetworkEntity.js`):

- One class per entity type, handling both **authority** (local simulation) and **non-authority** (remote replication) via `isAuthority`
- `getNetworkState()` / `setNetworkState()` for serialization
- Authority can transfer at runtime (e.g., grab/release)
- Register with `EntityManager` — sync is automatic

### Hosting Modes

| Mode | Description |
|------|-------------|
| **Host & Play** | Host + play as a player avatar |
| **Dedicated Host** | Host as a spectator (free-fly camera, no avatar) |
| **Local Server** | Node.js serves the app + runs PeerJS signaling on LAN |

## Project Structure

```
├── index.html          # Entry HTML
├── style.css           # Global styles
├── server.js           # Local Node.js server
├── src/
│   ├── core/           # GameState, EventBus, GameEngine
│   ├── entities/       # NetworkEntity, LocalPlayer, RemotePlayer, SpectatorEntity, PhysicsEntity
│   ├── managers/       # UI, Network, Render, Physics, Input, HUD, Player, Entity, Media, Room
│   ├── skills/         # Movement, Grab (player abilities)
│   └── utils/          # Constants, VirtualJoystick, HostKeepalive
└── vite.config.js
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (HTTPS, hot reload) |
| `npm run build` | Production build → `dist/` |
| `npm run serve` | Local Express + PeerJS server |
| `npm run preview` | Preview production build |
