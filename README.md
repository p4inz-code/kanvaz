
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

> **v4.7.0** — Organize & Connect: Board View gains card renaming (double-click or right-click), Map View gains search/filter, multi-select with bulk tag/delete, and node color-coding by tag or type. Tag chips and video/audio playback controls now resize smoothly and proportionally with the card instead of staying flat-sized or popping in/out at fixed breakpoints. The dot-grid background no longer fades to nothing at maximum zoom-out. See [CHANGELOG.md](CHANGELOG.md) for the full list.
>
> **v4.5.1** — MCP Bridge goes from "edit cards" to nearly the whole app: board management (create/switch/rename/save/delete — deletion confirm-gated, since it's the one action on this whole surface that isn't undo-reversible), undo/redo, view control, card extras (flip/duplicate/z-order), and every app setting except plugin management, all now AI-drivable through the same 30-tool MCP surface. (4.5.1 is a CI-only follow-up — same app, fixes the macOS release build.) See [CHANGELOG.md](CHANGELOG.md) for the full list.
>
> **v4.4.0** — Plugin ecosystem: hardening, distribution & MCP Bridge. Kanvaz becomes agent-controllable: the new MCP Bridge official plugin lets Claude Desktop, Claude Code, or any MCP client read and edit your active board over a local-only connection (off by default, every change undo-reversible). Ships alongside real per-plugin permission enforcement (a gated capability is now genuinely absent from a plugin's API view unless declared and approved, not just undocumented), CI packaging automation for official plugins, a one-click "Browse Official Plugins" tab, and a "Load unpacked plugin" dev workflow. See [CHANGELOG.md](CHANGELOG.md) for the full list.
>
> **v4.3.0** — Command Palette & Plugin Runtime API: press Ctrl+K to run any Kanvaz shortcut or plugin-registered command by name, plugins can now register their own commands and react to app events (card create/update/delete, board load/save, selection change), and a read-only Runtime Data API (`getCards`/`getSelected`/`getConnections`/`getActiveBoard`) lays the groundwork for v4.4's MCP Bridge. See [CHANGELOG.md](CHANGELOG.md) for the full list.
>
> **v4.2.2** — Visual polish and reliability pass: unified modal/panel styling (radius, shadow, entrance animation) across every panel in the app, a proper design-language icon set replacing leftover emoji, native connection-type colors instead of a borrowed palette, plus fixes for Top Mode's drag-to-move losing its grip mid-drag and Map View connections drifting after a window resize. See [CHANGELOG.md](CHANGELOG.md) for the full list.
>
> **v4.2.1** — Full-stack audit and hardening pass across every source file: a plugin-storage race, several data-loss and XSS-adjacent bugs, Caps-Lock-broken shortcuts, and a round of UI copy that no longer matched actual behavior, all fixed. See [CHANGELOG.md](CHANGELOG.md) for the full list.
>
> **v4.2.0** — The foundation of a plugin system: third parties can add new card types without forking Kanvaz, installed by dropping a folder in (no build step). Enabling a plugin always goes through a native, permission-disclosing OS dialog, and Theme Creator ships as the first official plugin. See [CHANGELOG.md](CHANGELOG.md) for the full list.
>
> **v4.1.0** — URL and File reference cards (link/point at something without embedding it), a safer `.kanvaz` file format (zip container with per-asset integrity checks instead of one giant base64 JSON blob — old files still open fine), and another security/reliability pass.
>
> **v4.0.1** — Foundation hardening pass: a full bug-hunt audit across every source file, fixing a save-file data-loss bug, a broken Select All, a minimap pan bug, two Escape-key bugs, and a dozen other issues.
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

**100% Offline** — no accounts, no telemetry, no internet required. Your `.kanvaz` files never leave your machine. The one exception: an optional "Check for updates" button in the About screen, which fires two GitHub requests (the built-in updater's own check, plus a version-info lookup for the About screen) — only if you click it, never automatically.

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
- Optional update check (About screen) — the only network activity in the entire app (two GitHub requests: the built-in updater's own check, plus a version-info lookup), fires only when you click it, never automatically
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
- URL reference cards — paste a link, open it in your default browser or copy it; never fetches previews/favicons, so this stays 100% offline like everything else
- File reference cards — point at a file anywhere on disk (a source PSD, a script, a brief) without embedding it; open with its default app or re-point it to a different file anytime
- Plugin system — drop a folder in or use the one-click "Browse Official Plugins" tab (Settings → Plugins) to add new card types, commands, event hooks, or full themes; enabling one always goes through a native, permission-disclosing dialog, and a board never breaks even if a plugin it depends on is later disabled or removed
- Command Palette (Ctrl+K) — fuzzy-search and run any Kanvaz shortcut or plugin-registered command by name
- MCP Bridge (official plugin, off by default) — lets an MCP-compatible AI client (Claude Desktop, Claude Code, ...) read and edit your active board over a local-only connection; every change lands in undo history like a manual edit

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
Output: `dist/Kanvaz Setup 4.7.0.exe` and `dist/Kanvaz 4.7.0.exe`

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

As of 4.1.0, a `.kanvaz` file is a zip container — `board.json` (the same board/card/connection structure Kanvaz has always used) plus one file per embedded image/video/audio asset, each with a SHA-256 hash recorded for corruption detection. This replaced the old plain-JSON-with-everything-base64-encoded format, which inflated media by ~33% and put your whole board at risk if a single byte anywhere in that one giant JSON string got corrupted. A damaged asset now degrades to that one card showing "missing media" instead of threatening the rest of the file.

Files saved by 4.0.1 and earlier (plain JSON, base64 media) still open exactly as before — Kanvaz detects the format automatically and only ever writes the new container going forward. Connections are stored as a top-level `connections` array alongside boards. Files from v2.x load cleanly with zero connections.

---

## Known limitations

- Properties panel is basic key-value editing only (text values) — no dropdown/date/number field types yet.
- MKV and AVI video files may not play (Chromium codec limitation) — MP4 (H.264) and WebM recommended. Kanvaz now tells you plainly when this is why a video card failed, instead of a generic "missing media" message.
- PDF reference cards aren't implemented — there's no `pdf` card type or creation UI today (unlike `url` and `file`, which fully ship as of 4.1.0). A real PDF card type (with page thumbnails) is a possible future addition, not something partially built.
- Cross-board connections aren't possible from the UI — the data model doesn't prevent it, but only one board's cards are ever loaded at a time, so the "Connect to" picker can only offer cards from the board you're currently on.
- Autosave writes to a recovery file only — "Unsaved changes" in the status bar clears only on explicit Save (Ctrl+S). The recovery file is now cleared on every clean close (v3.6.5) so the "Recover unsaved board?" prompt only appears after an actual crash, not on every launch.
- The base installer itself still bundles zero plugins by design (see the Plugin System section of [SECURITY.md](SECURITY.md)) — Theme Creator and MCP Bridge, Kanvaz's two official plugins, both install separately (folder-drop or the one-click Browse Official Plugins tab), the same way any third-party plugin does. Enabling a newly-approved plugin takes effect immediately; disabling one takes effect after restart. Per-permission enforcement is real for the `server` capability (MCP Bridge's) as of 4.4.0, but not yet for `network`/`filesystem` — see SECURITY.md's trust-model section for exactly what that does and doesn't cover today.
- `registerPropertyFieldType` (custom Properties panel field types via a plugin) is still unimplemented — the API sketch exists in `docs/PLUGIN_SYSTEM_DRAFT.md` but nothing calls it yet.

---

## Roadmap

Kanvaz 4.x is intended to be the last major version, with only small fixes after a few more builds — so this is a short list of genuinely-still-open items rather than a long-term plan:

- Real PDF reference cards (page thumbnails, not just an "open externally" pointer)
- Richer Properties panel field types (dropdown, date, number, checkbox) — likely to ship as a plugin now that the plugin system exists, rather than a core feature
- Cross-board connections, if it turns out to matter enough to design the UI for it
- Map View auto-layout algorithms
- Plugin authoring docs + a scaffold template (there's a design draft and two real official plugins to learn from — Theme Creator and MCP Bridge — but no "start here" template yet), planned for v5.0
- `registerPropertyFieldType` (custom Properties panel field types via a plugin)

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
