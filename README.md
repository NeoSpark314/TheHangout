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

### Static site version

```bash
npm run build        # Build the client
```
Web page will be in `dist/` directory.

### Server
default starts on port 443 (tries to generate self-signed certs; give your own via --cert and --key flags); no PeerJS used (local WebSocket relay used instead)

```bash
npm run build        # Build the client
npm run serve        # Start 
```
