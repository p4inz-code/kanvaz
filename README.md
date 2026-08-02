
<p align="center">
  <img src="https://github.com/p4inz-code/kanvaz/blob/main/assets/banner.png?raw=true" alt="Kanvaz Banner" width="100%">
</p>

<p align="center">
  <a href="https://github.com/p4inz-code/kanvaz/releases/latest"><img src="https://img.shields.io/github/v/release/p4inz-code/kanvaz?style=flat-square&color=9D7FFF" alt="Release"></a>
  <a href="https://github.com/p4inz-code/kanvaz/releases/latest"><img src="https://img.shields.io/github/downloads/p4inz-code/kanvaz/total?style=flat-square&color=4ECDC4&label=downloads" alt="Downloads"></a>
  <a href="https://github.com/p4inz-code/kanvaz/stargazers"><img src="https://img.shields.io/github/stars/p4inz-code/kanvaz?style=flat-square&color=FFD700" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/p4inz-code/kanvaz?style=flat-square&color=FF6B6B" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/offline-100%25-green?style=flat-square" alt="Offline">
</p>

# Kanvaz

**Reference Operating System**

> **v4.0.1** — Foundation hardening pass: a full bug-hunt audit across every source file, fixing a save-file data-loss bug, a broken Select All, a minimap pan bug, two Escape-key bugs, and a dozen other issues. See [CHANGELOG.md](CHANGELOG.md) for the full list.
>
> **v4.0.0** — Quality release: full UI/UX polish pass across all 6 card types (relink broken media, video speed control + scrub, audio waveforms, live annotation indicator, color format cycling, and more), an unsaved-changes indicator, a polished installer, GitHub Actions CI, and an opt-in auto-updater.
> Board View, Connection System, and Inspector are stable and shipping.
> Map View is functional and receiving polish updates.

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

**100% Offline** — no accounts, no telemetry, no internet required. Your `.kanvaz` files never leave your machine. The one exception: an optional "Check for updates" button in the About screen makes a single request to GitHub — only if you click it, never automatically.

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
- Top Mode (Tab, or Ctrl+Shift+F) — hide all UI for distraction-free presenting; hover the top edge to briefly bring back the title/toolbar without exiting, Esc or Tab to fully exit
- Auto-hide toolbar (Settings → Behavior, off by default) — same hover-to-reveal chrome as Top Mode, but as a standing preference instead of a shortcut-gated mode; also relaxes the minimum window size for a PureRef-style compact footprint
- Grid snap (Settings → Behavior, off by default) — snaps card width/height/position to the grid on both move and resize, choice of Minor (24px) or Major (120px) increment
- Developer settings (Settings → Developer) — FPS/render-time overlay, card/connection ID overlay, manual diagnostics trigger, bulk test-card generator, one-click debug-info export for bug reports
- Top Mode auto-enables Always on Top (Settings → Behavior, off by default) — restores your prior Always-on-Top state when you exit Top Mode
- Tab+MMB whole-window drag — hold Tab and drag with the middle mouse button to move the window from anywhere on screen
- Optional update check (About screen) — the one network call in the entire app, fires only when you click it, never automatically
- Reset Kanvaz (Settings → Reset) — clears settings, recent-files list, and autosave/recovery cache, then restarts. Never touches saved `.kanvaz` boards, which always live outside the app's own data folder regardless of where you save them
- Tag editing — add/remove tags directly on any card, shown as chips on hover/selection
- Search/filter (`/` or Ctrl+F) — live filter by name, type, or tag; matches stay full-opacity, everything else dims so you keep spatial context
- Always on top (T) — persists across restarts
- Board/Map segmented toggle in toolbar
- Light / dark theme (press L or change in Settings)
- Type-aware context menus (note cards hide irrelevant media options)
- Crash-safe save — writes to a temp file first, then renames, so a crash mid-save can't corrupt your board
- Settings migration — automatically upgrades settings across versions without data loss
- `.pur` file import — drag-drop or menu-import PureRef boards with position/scale preserved
- Properties panel (E) — attach custom key-value metadata to any card
- Color picker card type — solid color swatches with native OS color picker

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
Output: `dist/Kanvaz Setup 4.0.1.exe` and `dist/Kanvaz 4.0.1.exe`

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
| Ctrl+F or / | Search/filter cards |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+A | Select all cards |
| Delete | Delete selected card |
| Ctrl+D | Duplicate card |
| P | Pin / unpin card |
| A | Annotate selected card |
| C | Connections inspector |
| E | Properties panel |
| M | Toggle Board / Map view |
| H | Hide annotations |
| Arrow keys | Nudge card 1px |
| Shift+Arrow | Nudge card 10px |
| Tab | Top Mode — hide all UI (also Ctrl+Shift+F) |
| S | Settings (toggle open/close) |
| I | About (toggle open/close) |
| ? | Shortcuts overlay (toggle open/close) |
| Esc | Deselect / close panels / cancel wire / exit Top Mode |

---

## File format

Boards are saved as `.kanvaz` files — plain JSON with version `"4.0.1"`. Media is embedded as base64 data URLs. Connections are stored as a top-level `connections` array alongside boards. Files from v2.x load cleanly with zero connections.

---

## Known limitations

- Properties panel is basic key-value editing; richer field types planned for v4.
- `.kanvaz` files embed media as base64, so files with large video/audio can get large.
- MKV and AVI video files may not play (Chromium codec limitation) — MP4 (H.264) and WebM recommended.
- Autosave writes to a recovery file only — "Unsaved changes" in the status bar clears only on explicit Save (Ctrl+S). The recovery file is now cleared on every clean close (v3.6.5) so the "Recover unsaved board?" prompt only appears after an actual crash, not on every launch.

---

## Roadmap

**v3.9.0** — Next milestone. Focus areas: URL card type with link previews, PDF card type with page thumbnails, auto-layout algorithms for Map View, and batch operations (multi-select tag/property editing).

**v4.0** — Long-term. Auto-updater (Squirrel or electron-updater), auto-layout algorithms for Map View, and the remaining reference types (URL, PDF, Color, File, Outcome) that are registered in the type system but don't have creation UI yet.

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
