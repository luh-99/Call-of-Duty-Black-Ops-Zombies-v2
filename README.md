# Call of Duty: Black Ops Zombies v2

A browser-based, locally hosted mirror of classic Black Ops 1 zombie maps. This project serves a static web experience that recreates the map selection flow, loads the game assets, and runs the browser engine with support for solo and co-op style room signaling.

## Overview

This repository contains a self-contained web app and lightweight local server for hosting a BO1 Zombies experience directly in the browser. It includes:

- a map selection landing page
- individual map pages for the supported maps
- browser-side gameplay logic and UI
- offline asset manifests for map data and game resources
- local or network hosting scripts for serving the project to a browser
- a lightweight room-signaling service for co-op lobby coordination

The project is designed to run from a local machine and supports LAN or internet hosting via the included servers.

## Supported maps

The repository includes support for the following maps:

- Kino der Toten
- Five
- Der Riese
- Nacht der Untoten
- Verrückt
- Shi No Numa
- Ascension
- Call of the Dead
- Shangri-La
- Moon

## Features

- Browser-based BO1 Zombies map launcher
- Single-page map selection flow matching the original presentation style
- Offline asset streaming through manifest-driven pack loading
- Co-op room creation and signaling via `/bsz/rooms`
- Local or network-accessible hosting
- No extra installation required beyond Python for the included server scripts

## Repository layout

- `Serve-local.py` — local-only HTTP server for serving the site on `127.0.0.1:1000`
- `Serve-local.mjs` — equivalent local server in JavaScript
- `Serve-wan.py` — LAN/internet-capable HTTP server binding to all interfaces
- `Serve-wan.mjs` — JavaScript version for WAN hosting
- `index.html` — main landing page and map selection screen
- `manifest.json` — base game asset manifest
- `art/` — artwork and UI assets
- `artifacts/` — packaged game artifacts and associated data
- `acension/`, `five/`, `kino/`, etc. — per-map manifests and directories
- `*.js` — gameplay, engine, UI, networking, and audio logic
- `*.css` — styling for menus and gameplay interfaces
- `*.html` — individual map pages and screens

## Running locally

Python is the simplest option for local development or play:

```bash
python Serve-local.py
```

Then open:

```text
http://127.0.0.1:1000/bsz/
```

To expose the site beyond localhost:

```bash
python Serve-wan.py
```

This binds the server to all interfaces so friends on the same network or forwarded internet traffic can access it.

## Hosting notes

The serving scripts intentionally map the site under the `/bsz` path and keep older `/bo1z` links working as an alias. The server also provides the co-op room signaling service used by the browser lobby.

Important browser security headers are included to support SharedArrayBuffer and related browser requirements for the engine.

## Project statistics

Language composition for this repository:

- JavaScript: 85.6%
- HTML: 5.8%
- Python: 5.2%
- CSS: 3.4%

## Notes

This project is a web port/mirror of BO1 Zombies assets and gameplay experience rather than an original game build. It depends on the game data manifests and browser runtime assets included in the repository.

## License and usage

This repository does not appear to include an explicit license file. Review the repository contents and any upstream distribution terms before reusing or redistributing the assets for commercial or public-facing use.

## Quick start summary

```bash
python Serve-local.py
# then browse to http://127.0.0.1:1000/bsz/
```
