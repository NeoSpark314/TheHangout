# The Hangout

A playful shared space for small groups, designed VR-first but usable from desktop and mobile.

## Main objectives

- quick to join
- fun
- VR-first design with desktop and mobile support
- static-hostable client version with PeerJS signaling
- dedicated server mode for internal or offline networks

## Docs

Current contributor docs live under `docs/`:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/GAMEPLAY_API.md](docs/GAMEPLAY_API.md)
- [docs/SCENARIO_API.md](docs/SCENARIO_API.md)
- [docs/REPLICATION.md](docs/REPLICATION.md)

## Quick Start

### Development

```bash
npm install
npm run dev
```

### Static site build

The first user becomes host. Signaling uses PeerJS.

```bash
npm run build
```

The built client is written to `dist/`.

### Dedicated Server

Default starts on port `443`. If `--cert/--key` are not provided, the local SSL fallback is used.

```bash
npm run build
npm run serve
```

### Desktop Sharing Page (`/share`)

When running the local server, open this URL on the desktop machine you want to stream:

```bash
https://<server-address>/share
```

Steps:

- enter your global share key
- click **Connect** and then **Share**
- keep the page open so the session can summon and stop the stream from VR
