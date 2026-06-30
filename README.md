# Kanvaz

**Reference Operating System**

> **v3.5.1** — Board View, Connection System, and Inspector are stable and shipping.
> Map View (node-editor graph) is under active development — functional but receiving polish updates.

Collect, organize, connect, and understand your references — all offline.
Kanvaz is a free, open-source desktop app for VFX artists, 3D artists, and creative professionals who work with visual references.

### [⬇ Download for Windows](https://github.com/p4inz-code/kanvaz/releases/latest)

Grab the latest installer from the [Releases page](https://github.com/p4inz-code/kanvaz/releases/latest).

> **Note:** Kanvaz isn't code-signed (signing certificates cost money and
> this app is free). When you run the installer, Windows will likely show
> a blue **"Windows protected your PC"** screen. This is normal for
> unsigned indie apps — click **"More info"** → **"Run anyway"**.
>
> Prebuilt downloads are Windows only. macOS and Linux users can build
> from source — see [Build installers](#build-installers) below.

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## What Kanvaz Does

**Board View** — an infinite pan/zoom canvas where you drop images, GIFs, videos, audio, and notes. Arrange freely, annotate on top, organize across multiple boards in one file.

**Connection System** — link any reference to another with typed, directional relationships (Related To, Inspired By, Derived From, Alternative To, Supports, Used In, References). Each connection carries optional notes and priority.

**Map View** *(under active development)* — a node-editor-style graph that visualizes all your references and connections. Drag from output ports to input ports to create connections. Bezier tube cables with glow and colored dot terminators. Independent pan/zoom from the board canvas.

**Connection Inspector** — select any reference and press C to see all its incoming and outgoing connections. Create, edit, and delete relationships from a side panel.

**100% Offline** — no accounts, no telemetry, no internet required. Your `.kanvaz` files never leave your machine.

---

## Features

- Infinite pan/zoom canvas (8%–500%)
- Image, GIF, video, and audio cards with full playback controls
- Note cards with inline text editing
- Pen, arrow, and rectangle annotation tools in 6 colors
- Multiple boards in one file, each with its own cards and view state
- Reference Connection System with 7 relationship types
- Map View with node-editor-style bezier tube connections
- Connection Inspector panel (view, create, edit, delete connections)
- Undo/redo up to 50 steps (includes connection changes)
- Autosave crash recovery (writes to recovery file every 30s)
- Mood lock (Ctrl+Shift+F) — hide all UI for distraction-free presenting
- Always on top (T) — persists across restarts
- Board/Map segmented toggle in toolbar
- Light / dark theme (press L or change in Settings)
- Type-aware context menus (note cards hide irrelevant media options)

---

## Requirements

- Node.js 18+ ([nodejs.org](https://nodejs.org))
- npm 9+

---

## Run in development

```bash
npm install
npm start
```

---

## Build installers

**Windows (installer + portable):**
```bash
npm run build:win
```
Output: `dist/Kanvaz Setup 3.5.1.exe` and `dist/Kanvaz 3.5.1.exe`

**macOS:**
```bash
npm run build:mac
```

**Linux:**
```bash
npm run build:linux
```

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Scroll | Zoom in / out |
| Ctrl+Scroll | Fine zoom |
| Middle mouse / Space+drag | Pan |
| 0 | Reset zoom |
| F | Fit all cards |
| T | Always on top |
| L | Toggle light / dark theme |
| Ctrl+S | Save board |
| Ctrl+Shift+S | Save board as new file |
| Ctrl+O | Open board |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+A | Select all cards |
| Delete | Delete selected card |
| Ctrl+D | Duplicate card |
| P | Pin / unpin card |
| A | Annotate selected card |
| C | Connections inspector |
| M | Toggle Board / Map view |
| H | Hide annotations |
| Arrow keys | Nudge card 1px |
| Shift+Arrow | Nudge card 10px |
| Ctrl+Shift+F | Mood lock (fullscreen canvas) |
| ? | Shortcuts overlay |
| Esc | Deselect / close panels / cancel wire |

---

## File format

Boards are saved as `.kanvaz` files — plain JSON with version `"3.5.1"`. Media is embedded as base64 data URLs. Connections are stored as a top-level `connections` array alongside boards. Files from v2.x load cleanly with zero connections.

---

## Known limitations

- Tags and custom properties are in the data model but have no editing UI yet (planned for v4).
- `.kanvaz` files embed media as base64, so files with large video/audio can get large.
- MKV and AVI video files may not play (Chromium codec limitation) — MP4 (H.264) and WebM recommended.
- The annotation toolbar doesn't follow the canvas if you pan/zoom while it's open.
- Autosave writes to a recovery file only — "Unsaved changes" in the status bar clears only on explicit Save (Ctrl+S).

---

## Documentation

- [Technical Overview](docs/TECHNICAL_OVERVIEW.md) — architecture, module map, build conventions
- [Privacy](PRIVACY.md) — what Kanvaz does (and doesn't) do with your data
- [Third-Party Notices](THIRD_PARTY_NOTICES.md) — licensing for Electron and other bundled components
- [Changelog](CHANGELOG.md) — version history

---

## License

MIT — free forever.
Made by **Atharva Patil** — Northbyte Studios, Navi Mumbai, India.
