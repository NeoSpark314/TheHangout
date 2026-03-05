# The Hangout

A playful space for small groups of people to hang out. 

Main objectives:
- No setup, no accounts, quick to join
- Fun
- VR first design but usable from desktop and mobile
- Simple static version hostable on any static web server with PeerJS for signaling (no backend required)
- Server version for hosting on internal networks (works without internet connection or in more secure environments)

## Quick Start

### Development

```bash
npm install
npm run dev          # Development (Vite + PeerJS)
```

### Static site version (deploy on any static web server)
First user will be the host. It will use PeerJS for signaling.
```bash
npm run build        # Build the client
```
Web page will be in `dist/` directory.

### Dedicated Server
Default starts on port 443 (uses your `--cert/--key` if provided, otherwise falls back to `@vitejs/plugin-basic-ssl` certificate generation); no PeerJS used (local WebSocket relay used instead)

```bash
npm run build        # Build the client
npm run serve        # Start
```

### Desktop Sharing Page (`/share`)

When running the local server, open this URL on the desktop machine you want to stream:

```bash
https://<server-address>/share
```

Steps:
- Enter your global share key (for example `MyDesktopPC`)
- Click **Connect** and then **Share**
- Keep the page open (it will start/stop capture when summoned from VR Session tab)
