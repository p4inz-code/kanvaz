# Technical Overview

This document describes how Kanvaz is built, for anyone reading the
source, considering a contribution, or just curious how it works.

## Stack
- **Electron 22.3.27** (locked — see "Why pinned versions" below)
- **electron-builder 24.13.3** for packaging installers
- Plain JavaScript (ES5-style `var`, no build step, no bundler, no
  frontend framework) — the entire UI is hand-written HTML/CSS/JS
- No runtime dependencies. The only `devDependencies` are Electron and
  electron-builder themselves.

## Why pinned versions
Electron and electron-builder are intentionally pinned and not meant to
be upgraded. The app was built and tested against these exact versions.
Newer major versions of Electron can introduce breaking changes (security
defaults, Node integration changes, etc.) that would require a re-audit
of the whole app. The pin avoids "working build today, broken build after
`npm install` next year."

## Module map (`src/`)

| File | LOC | Responsibility |
|---|---|---|
| `main.js` | 333 | Electron main process — window management, all IPC handlers (file read/write, dialogs, recovery, recent files, media loading with size/type checks), close-with-unsaved-changes interception |
| `preload.js` | 57 | `contextBridge` API exposed to the renderer as `window.KanvazBridge` — only whitelisted IPC channels are exposed |
| `errors.js` | 74 | Centralized error-code → user-facing message mapping, global error boundary |
| `reference-types.js` | 93 | Type registry for 10 reference types (image, gif, video, audio, note, url, pdf, color, file, outcome) with icons, categories, and field definitions |
| `media.js` | 203 | Media type detection (image/GIF/video/audio), natural-size probing, drop-size capping |
| `canvas.js` | 401 | Pan/zoom with rAF-throttled grid redraw, batched dot rendering, tx/ty bounds clamping, screen↔world coordinate conversion, drag-and-drop entry point |
| `cards.js` | ~1060 | Card (reference) data model and rendering. Uses event delegation — 3 listeners attached once to the canvas, never re-bound. Builds each card type (image/GIF/video/audio/note) with resize handles, pin, duplicate, delete. Serialise/deserialise with v3 fields (tags, properties, mapPosition, url, color, mimeType). Cascade-deletes connections on card delete. Closes inspector on card delete. |
| `connections.js` | 220 | CRUD for directional reference relationships. 7 built-in types (RelatedTo, InspiredBy, DerivedFrom, AlternativeTo, Supports, UsedIn, References). Duplicate prevention, collect-then-delete safe iteration, cascade removal. File-level storage (not per-board). |
| `history.js` | 130 | Undo/redo stack (50 steps). Snapshots include both references and connections as `{ refs, conns }` with backward compat for v2 plain-array snapshots. Shares immutable fields (media data, type, id) by reference and deep-copies mutable fields (position, size, tags, properties, mapPosition). Re-renders map view and refreshes inspector on restore. |
| `annotate.js` | 518 | Per-card canvas overlay for pen/arrow/rectangle annotations in 6 colors |
| `boards.js` | ~580 | Multi-board state — create/rename/delete/switch tabs, save/load `.kanvaz` files, serialization with connections, recovery autosave with try-catch and status indicator, startup screen, map view state save/restore per board. Cascade-deletes connections on board delete. Clears connections on new board. |
| `inspector.js` | 599 | Connection Inspector side panel — shows incoming/outgoing connections for a selected reference with type tags, priority indicators, notes. Create/edit/delete dialogs. Double-click row to jump to connected reference. |
| `map-view.js` | ~960 | Node-editor-style relationship visualization. References as compact cards with input/output port dots. Bezier tube connections with glow + shadow + colored dot terminators. Drag-from-port wire creation with live preview. Independent pan/zoom, fit-all on first open, empty state. Right-click context menu per node. Keyboard delegation (blocks board-specific shortcuts when active). |
| `shortcuts.js` | ~155 | Global keyboard shortcut handling. Shortcut order: file ops → undo/redo → global (T, ?, M) → map delegation (blocks board shortcuts when map active) → board zoom → board card ops. Respects text input focus and OS key-repeat. |
| `ui.js` | ~620 | Settings panel with 10+ toggleable options, About screen, shortcuts-reference overlay, first-run dialog. Persists settings via IPC. Calls `startAutosave()` after settings load. |
| `app.js` | ~660 | Renderer entry point: boot sequence, toolbar button wiring, context menu builder (type-aware), drag-drop handling with format warnings, clipboard paste, window chrome, dirty/save-state tracking, recovery dialog, mood lock. |

**Total**: ~6,900 LOC across 16 modules.

## File format (v3.x)

`.kanvaz` files are plain JSON:

```json
{
  "version": "3.5.1",
  "savedAt": "ISO timestamp",
  "activeIdx": 0,
  "boards": [
    {
      "id": "board-xxx",
      "name": "Board 1",
      "cards": [ ... ],
      "canvasTx": 0, "canvasTy": 0, "canvasScale": 1.0,
      "mapTx": 0, "mapTy": 0, "mapScale": 1.0
    }
  ],
  "connections": [
    {
      "id": "conn-xxx",
      "fromRefId": "card-xxx",
      "toRefId": "card-yyy",
      "type": "InspiredBy",
      "note": "Color palette from this",
      "priority": 2,
      "dateCreated": "ISO",
      "dateModified": "ISO"
    }
  ]
}
```

Each card includes v3 fields: `tags` (array), `properties` (object),
`mapPosition` ({x, y}), `url`, `color`, `mimeType`. V2 files load
cleanly — missing fields default to null/empty.

## Design conventions
- **Dark theme only**, fixed color palette (CSS custom properties in `main.css`).
  Text minimum contrast floor: `#6A6A8A`.
- **`var` only** — no `const`/`let`/arrow functions/`.forEach()`. Consistency
  choice, enforced across all 16 source files.
- **No white UI elements** — all surface colors are dark-range hex values.
- **Six version locations** bumped atomically on every release:
  `package.json`, `boards.js` VERSION, `ui.js` About screen (×2),
  `README.md` build output, `generate_overview_pdf.py` footer.

## Architecture decisions
- **Connections are file-level, not board-level.** A connection can link
  references across boards. `clearAll()` in cards.js does NOT clear
  connections — that's handled at the boards.js level (newBoard, deleteBoard).
- **Autosave writes to a recovery file only** — never to the user's actual
  `.kanvaz` file. This preserves the "Don't Save" choice in the close dialog.
- **Map View shortcuts are isolated.** When map view is active, all board-
  specific shortcuts (zoom, delete, nudge, flip, etc.) are blocked to
  prevent invisible modifications to the hidden board canvas.
- **Video cards use deferred playback.** `vid.onloadeddata` triggers play
  instead of `autoplay` to prevent corrupt partial display on slow loads
  or unsupported codecs.
