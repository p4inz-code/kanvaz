
<p align="center">
  <img src="https://github.com/p4inz-code/kanvaz/blob/main/assets/banner.png?raw=true" alt="Kanvaz Banner" width="100%">
</p>

<p align="center">
  <a href="https://github.com/p4inz-code/kanvaz/releases/latest"><img src="https://img.shields.io/github/v/release/p4inz-code/kanvaz?style=flat-square&color=9D7FFF" alt="Release"></a>
  <a href="https://github.com/p4inz-code/kanvaz/releases/latest"><img src="https://img.shields.io/github/downloads/p4inz-code/kanvaz/total?style=flat-square&color=4ECDC4&label=downloads" alt="Downloads"></a>
  <a href="https://github.com/p4inz-code/kanvaz/stargazers"><img src="https://img.shields.io/github/stars/p4inz-code/kanvaz?style=flat-square&color=FFD700" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/p4inz-code/kanvaz?style=flat-square&color=FF6B6B" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/offline-100%25-green?style=flat-square" alt="Offline">
</p>

# Kanvaz

### The Reference Operating System, for artists who think in images, not folders.

Stop tabbing between fifty browser windows and a messy Explore folder. Kanvaz is a free, open-source, **100% offline** infinite canvas built for VFX artists, 3D artists, and anyone whose real workflow is collecting references, connecting ideas, and actually finding them again later.

Drop in 3D models, images, video, audio, PureRef boards, and files. Wire references together with typed connections. Share the same card across boards with zero duplication. Extend it with plugins, or write your own and sell it.

No account. No cloud. No subscription. Just a canvas that's actually yours.

<p align="center">

### [⬇ Download for Windows, it's free](https://github.com/p4inz-code/kanvaz/releases/latest)

</p>

> **Note:** Kanvaz isn't code-signed (certificates cost money; this app doesn't). Windows will likely show **"Windows protected your PC."** Click **"More info" → "Run anyway."** That's normal for unsigned indie software, not a red flag.
> Prebuilt installers are Windows only. macOS and Linux users build from source, see [Build installers](#build-installers).

<p align="center"><i>Built as an ongoing side project, no fixed roadmap, mostly driven by whatever feedback comes in. Found a bug or want a feature? <a href="https://github.com/p4inz-code/kanvaz/issues">Open an issue</a> or email <b>atharva.patil.cg@gmail.com</b>, both get read.</i></p>

---

## Latest release

**v8.4.0** persists 3D camera orbit position across saves — reopen a model and it's framed exactly how you left it, instead of resetting to a default view every time. v8.3.0 before it added `.blend` support via a local Blender install; v8.0.0–v8.2.0 added `.stl`/`.ply`/`.vox`/the whole USD family. Every release, with the reasoning behind it, is in [CHANGELOG.md](CHANGELOG.md).

<table>
<tr>
<td width="50%" align="center">
<b>🌙 Dark theme</b><br><br>
<img src="assets/screenshot-showcase-dark-v7.26.0.png" alt="Kanvaz reference board in dark theme — image, note, color, and URL cards with a Related To connection" width="100%">
</td>
<td width="50%" align="center">
<b>☀️ Light theme</b><br><br>
<img src="assets/screenshot-showcase-light-v7.26.0.png" alt="The same Kanvaz reference board in light theme" width="100%">
</td>
</tr>
</table>
<p align="center"><i>Same board, either theme — press <code>L</code> to switch, no restart needed.</i></p>

<p align="center">
  <img src="assets/screenshot-home-v7.22.0.png" alt="Kanvaz Home Screen — Quick Start, template previews, and a What's New section reading live off the changelog" width="720">
</p>

<details>
<summary><b>More screenshots</b> — Layers panel, multi-select Align/Distribute/Tidy Up, classic card design</summary>
<br>

<p align="center">
  <img src="assets/screenshot-layers-v7.22.0.png" alt="Kanvaz Layers panel — every card in z-order, pin and hide icons, a pinned card highlighted on the board" width="720">
  <br><i>Layers panel: every card in z-order, click to select, drag to reorder, pin/hide icons.</i>
</p>

<p align="center">
  <img src="assets/screenshot-align-v7.22.0.png" alt="Kanvaz Properties panel — Align, Distribute Evenly, and Tidy Up selection controls with three selected cards" width="720">
  <br><i>Align, Distribute Evenly, and Tidy Up — all in the Properties panel.</i>
</p>

<p align="center">
  <img src="assets/screenshot-cards-v7.9.0.png" alt="Kanvaz card design — note, URL, and color cards showing the always-visible name/metadata footer" width="720">
  <br><i>Card design: always-visible name and metadata footer, one clean type badge.</i>
</p>

</details>

---

## What makes Kanvaz different

Most reference boards stop at "put images on a canvas." Kanvaz goes further, and these are the ones worth trying first:

- **Real 3D model preview, not a static thumbnail.** Drop in a `.glb`/`.gltf`/`.obj`/`.fbx`/`.stl`/`.ply`/`.vox`/`.usd`/`.usdz` and orbit it live, right on the board — Normal/Wireframe/Matcap shading, animation playback with a scrub bar. No other offline reference tool does this. `.blend` files preview too, if you have Blender installed — Kanvaz converts and renders them the same way; without Blender, they become a plain file reference instead of failing.
- **One card, many boards, zero duplication.** Share a reference across a Character board and a Lighting board — edit it once, and it updates everywhere it's used. Most tools make you choose between duplicating a file or losing track of where it lives.
- **An AI can read and edit your board locally, with your permission.** The MCP Bridge plugin lets Claude Desktop or Claude Code query and modify the active board over local IPC, never the network — every change is undo-reversible like anything else you'd do by hand.
- **Typed connections, visualized as a real graph.** Not just arrows — 7 relationship kinds (Inspired By, Derived From, Alternative To, and more), viewable as a node-editor-style Map View when you want to see the whole web of ideas at once.
- **Sell your own plugin. Kanvaz never takes a cut.** Register card types, commands, or full themes through a real runtime API — there's no in-app marketplace standing between you and the people who'd pay for your plugin.
- **100% offline, and it stays that way.** No account to lose access to, no subscription that stops working, no telemetry phoning home. The only network calls anywhere in the app are ones you click yourself.

---

## Why Kanvaz

| | |
|---|---|
| 🖼️ **One canvas for everything** | 3D models, images, GIFs, video, audio, notes, colors, URLs, and file pointers. Drop it in, arrange it freely, annotate on top. Multiple boards per file, each with its own view state. |
| 🔗 **Shared cards across boards** | The same card can live on more than one board with zero duplication. Edit it on either one, and the change is there next time you open the other. |
| 🧠 **Smart Search** | On-device, lemmatized/fuzzy search ("cars" finds "car"). Fully offline, off by default, about 4.5MB, zero native dependencies. |
| ✏️ **Real annotation tools** | Pen, arrow, rectangle, pixel-measure, and an eyedropper that samples actual pixel color, right on top of your reference. |
| 🕸️ **Connections + Map View** | Link any two references with typed, directional relationships. Visualize the whole web as a node-editor-style graph with bezier cables. |
| 🧩 **A real plugin ecosystem** | Add card types, commands, themes, or full features without forking Kanvaz. Sell your own plugin if you want. Kanvaz never takes a cut and never runs a marketplace. |
| 🔒 **100% offline, always** | No accounts, no telemetry, nothing phones home. The only network activity anywhere in the app is a button you click yourself (Check for Updates, Browse Plugins). Never automatic. |

---

## Features

**Canvas & organization**
- Infinite pan/zoom canvas (8%–500%), multiple boards per file
- Real board thumbnails on the Home Screen (generated from the actual card layout at save time)
- 3D model cards (`.glb`/`.gltf`/`.obj`/`.fbx`/`.stl`/`.ply`/`.vox`/`.usd`/`.usdz`, up to 150MB, plus `.blend` if Blender is installed): orbit with the mouse, Normal/Wireframe/Matcap shading, animation playback with a scrub bar, background color picker
- Image, GIF, video, and audio cards with full playback controls and a real volume slider
- Note, text, color, URL, and file-reference card types. A file reference pointing at a `.pdf` or image gets a real inline preview inside the resizable card
- Shared cards across boards: same content, no duplication, edit anywhere
- Tag editing, live search/filter (`/`), and Smart Folders (saved searches that re-run themselves)
- Color search: click a swatch, find every card that matches
- `.pur` file import via a toolbar button or drag-drop, both preserve position and scale
- Undo/redo up to 50 steps, autosave crash recovery, crash-safe atomic save
- Always-on-top by default (toggleable in Settings)

**Card design & templates**
- Every card shows an always-visible name and at-a-glance metadata (resolution, duration, character count) plus one clean type badge
- Photoshop/Illustrator-style Properties panel: Transform (X/Y/W/H), opacity, layer order, multi-select alignment, distribute-evenly, and Tidy Up, non-destructive Brightness/Contrast/Saturation for image/GIF/video, and Media info
- A Layers panel (its own side-panel tab): every card in z-order, click to select, drag to reorder, right-click for the full card menu, eye icon to hide/show, lock icon
- 13 board templates spanning VFX (three skill tiers), Game Dev, Music, Animation, Photography, Architecture, UI/UX, and Branding, plus the option to save your own board as a template

**Offline profiles**
- Fully offline, no-login multi-profile system: switch, create, or add a guest profile, each with its own settings, recent boards, and recovery data
- Export a profile to a portable file and import it on another machine, no network involved
- Per-profile plugin enable-state and storage, so two people sharing one install don't step on each other's plugin setup

**Annotation**
- Pen, highlighter, line, arrow, rectangle, ellipse, text stamp, pixel-measure, and eyedropper (real pixel sampling)
- Custom color picker with a recent-colors row, per-stroke opacity
- Video frame-stepping and onion-skin ghosting for checking animation timing
- Annotation toolbar scales with canvas zoom, so it doesn't shrink to nothing next to a zoomed-in card

**Connections**
- 7 typed relationship kinds (Related To, Inspired By, Derived From, Alternative To, Supports, Used In, References)
- Map View: node-editor-style graph, bezier tube connections, independent pan/zoom
- Connection Inspector panel (C): view, create, edit, delete from a side panel

**Plugin ecosystem**
- Drop a folder in, or one-click install from the in-app "Browse Official Plugins" catalog
- A richer runtime API: register card types, commands, themes, event hooks, even insert any card type from raw data
- MCP Bridge (official plugin): let an MCP-compatible AI client (Claude Desktop, Claude Code, and so on) read and edit your board locally, with every change undo-reversible
- Template Maker & Manager (official plugin): save boards as templates, browse and install community ones
- Explicit, considered permission to sell your own plugin. No in-app marketplace, ever

**Everything else**
- Command Palette (`Ctrl+K`): fuzzy-search and run any shortcut or plugin command
- Light/dark theme, type-aware context menus
- Settings migration across versions with zero data loss
- Developer tools: FPS overlay, ID overlays, one-click debug export for bug reports, with error toasts that actually show what went wrong

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
Output: `dist/Kanvaz Setup 8.4.0.exe` and `dist/Kanvaz 8.4.0.exe`

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
| Ctrl+K | Command Palette, fuzzy-search any shortcut or plugin command |
| L | Toggle light / dark theme |
| Ctrl+S | Save board |
| Ctrl+Shift+S | Save board as new file |
| Ctrl+O | Open board |
| Ctrl+F or / | Search/filter cards |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+A | Select all cards |
| Ctrl+drag, or V then drag | Box-select multiple cards (V toggles the mode, Esc exits) |
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
| Shift (while resizing) | Lock aspect ratio |
| S | Settings (toggle open/close) |
| I | About (toggle open/close) |
| ? | Shortcuts overlay (toggle open/close) |
| Esc | Deselect / close panels / cancel wire |

---

## File format

As of 4.1.0, a `.kanvaz` file is a zip container: `board.json` (the board/card/connection structure) plus one file per embedded image/video/audio asset, each with a SHA-256 hash recorded for corruption detection. This replaced the old plain-JSON-with-everything-base64-encoded format, which inflated media by about 33% and put your whole board at risk if a single byte anywhere in that one giant JSON string got corrupted. A damaged asset now degrades to that one card showing "missing media" instead of threatening the rest of the file.

As of 6.4.0, `board.json` also carries a top-level `sharedCards` registry. The content of any card shared across boards lives there once, keyed by a stable id, with each board's own `cards[]` holding only a lightweight position/size stub that references it. This is fully additive: older files simply have no stubs referencing anything and load with an empty registry.

Files saved by 4.0.1 and earlier (plain JSON, base64 media) still open exactly as before. Kanvaz detects the format automatically and only ever writes the current container going forward. Connections are stored as a top-level `connections` array alongside boards. Files from v2.x load cleanly with zero connections.

---

## Known limitations

- Custom key-value properties are text values only, no dropdown/date/number field types yet.
- MKV and AVI video files may not play (a Chromium codec limitation). MP4 (H.264) and WebM are recommended. Kanvaz tells you plainly when this is why a video card failed, instead of a generic "missing media" message.
- `.blend` preview requires a local Blender install (checked at a few common install locations, or on your system `PATH`) — Kanvaz has no `.blend` parser of its own, since none exists that's safe to bundle. Without Blender found, a dropped `.blend` file becomes a plain file-reference card instead of failing outright. Maya (`.mb`/`.ma`) and Houdini formats aren't supported yet — planned as the same kind of optional-external-tool conversion, not yet built.
- PDF preview only covers viewing (scroll/zoom/page nav). There's no text selection, search-within-PDF, or annotation on top of a PDF page yet.
- Cross-board connections between two independent cards aren't possible from the UI (only one board's cards load at a time, so the "Connect to" picker only offers cards on the board you're on). As of 6.4.0, sharing the *same* card across boards is possible and covers most of what people actually want this for.
- Autosave writes to a recovery file only. "Unsaved changes" in the status bar clears only on explicit Save (Ctrl+S). The recovery file is cleared on every clean close, so the "Recover unsaved board?" prompt only appears after an actual crash.
- The base installer bundles zero plugins by design (see [SECURITY.md](SECURITY.md)'s Plugin System section). Theme Creator, MCP Bridge, and Template Maker & Manager all install separately, the same way any third-party plugin does.
- `registerPropertyFieldType` (custom Properties panel field types via a plugin) is still unimplemented.
- 3D model cards embed the file (like image/video/audio) rather than pointing at it. A `.gltf` that references external `.bin`/texture files by relative path won't fully resolve (only a self-contained `.gltf` or a `.glb` is guaranteed to render everything); `.fbx` support is best-effort, since it's the most complex and least standardized of the four formats. Custom user-swappable textures aren't supported yet (planned as a future plugin).
- Per-profile plugin *storage* is isolated, but installed plugin code is still shared across all profiles on one machine, since installing a plugin is treated as a machine-level action, not a per-profile one.

---

## Roadmap

Kanvaz keeps getting developed as an ongoing side project, no fixed deadline, mostly driven by real feedback. The living plan lives in [docs/ROADMAP.md](docs/ROADMAP.md); the current batch in progress:

- Select, move, and delete an individual existing annotation stroke (today "Clear annotations" is all-or-nothing)
- A first-run "Set up your profile" screen and a profile picker built into the Start Screen itself
- Font and HDRI/EXR preview support
- General UI polish, ongoing

---

## Documentation

- [Technical Overview](docs/TECHNICAL_OVERVIEW.md): architecture, module map, build conventions
- [Privacy](PRIVACY.md): what Kanvaz does (and doesn't) do with your data
- [Third-Party Notices](THIRD_PARTY_NOTICES.md): licensing for Electron and other bundled components
- [Changelog](CHANGELOG.md): version history

---

## Related projects

Same engineering philosophy, same author, adjacent problem spaces:

- [3d-ref-skills](https://github.com/p4inz-code/3d-ref-skills)
- [reference-engineering](https://github.com/p4inz-code/reference-engineering) — the reference-engineering concept itself, proposed and developed independently of Kanvaz

## License

MIT, free forever.
Made by Atharva Patil | **[P4inz](https://github.com/p4inz-code)** | Northbyte Studios, Navi Mumbai, India.

<p align="left">
  <a href="https://github.com/p4inz-code"><img src="https://img.shields.io/github/followers/p4inz-code?style=flat-square&color=9D7FFF&label=follow%20%40p4inz-code" alt="Follow p4inz-code on GitHub"></a>
</p>
