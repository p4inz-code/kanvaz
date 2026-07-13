# Technical Overview

This document describes how Kanvaz is built, for anyone reading the
source, considering a contribution, or just curious how it works.

## Stack
- **Electron 22.3.27** (locked — see "Why pinned versions" below)
- **electron-builder 24.13.3** for packaging installers
- Plain JavaScript (ES5-style `var`, no build step, no bundler, no
  frontend framework) — the entire UI is hand-written HTML/CSS/JS
- No runtime dependencies. `devDependencies` are Electron, electron-builder,
  and `puppeteer-core` (dev-only — drives the automated real-Chromium
  port-alignment test, not shipped in the packaged app).

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
| `main.js` | 355 | Electron main process — window management, all IPC handlers (file read/write, dialogs, recovery, recent files, media loading with size/type checks), close-with-unsaved-changes interception, relaxed minimum window size while chrome auto-hide is active (Top Mode or the persistent setting) |
| `preload.js` | 58 | `contextBridge` API exposed to the renderer as `window.KanvazBridge` — only whitelisted IPC channels are exposed |
| `errors.js` | 74 | Centralized error-code → user-facing message mapping, global error boundary |
| `reference-types.js` | 93 | Type registry for 10 reference types (image, gif, video, audio, note, url, pdf, color, file, outcome) with icons, categories, and field definitions |
| `media.js` | 203 | Media type detection (image/GIF/video/audio), natural-size probing, drop-size capping |
| `canvas.js` | 476 | Pan/zoom with rAF-throttled grid redraw, batched major/minor line-grid rendering (v3.6.7 — was dots), tx/ty bounds clamping, screen↔world coordinate conversion, drag-and-drop entry point |
| `cards.js` | 1,144 | Card (reference) data model and rendering. Uses event delegation — 3 listeners attached once to the canvas, never re-bound. Builds each card type (image/GIF/video/audio/note) with resize handles, pin, duplicate, delete. Serialise/deserialise with v3 fields (tags, properties, mapPosition, url, color, mimeType). Cascade-deletes connections on card delete. Closes inspector on card delete. |
| `connections.js` | 222 | CRUD for directional reference relationships. 7 built-in types (RelatedTo, InspiredBy, DerivedFrom, AlternativeTo, Supports, UsedIn, References). Duplicate prevention, collect-then-delete safe iteration, cascade removal. File-level storage (not per-board). |
| `history.js` | 153 | Undo/redo stack (50 steps). Snapshots include both references and connections as `{ refs, conns }` with backward compat for v2 plain-array snapshots. Shares immutable fields (media data, type, id) by reference and deep-copies mutable fields (position, size, tags, properties, mapPosition). Re-renders map view and refreshes inspector on restore. |
| `annotate.js` | 518 | Per-card canvas overlay for pen/arrow/rectangle annotations in 6 colors |
| `boards.js` | 677 | Multi-board state — create/rename/delete/switch tabs, save/load `.kanvaz` files, serialization with connections, recovery autosave with try-catch and status indicator, startup screen, map view state save/restore per board. Cascade-deletes connections on board delete. Clears connections on new board. Migrates legacy pre-`boards[]` file shapes into a synthetic board on load (v3.6.5). |
| `inspector.js` | 599 | Connection Inspector side panel — shows incoming/outgoing connections for a selected reference with type tags, priority indicators, notes. Create/edit/delete dialogs. Double-click row to jump to connected reference. |
| `map-view.js` | 1,416 | Node-editor-style relationship visualization. References as compact cards with input/output port dots. Bezier tube connections with glow + shadow + colored dot terminators, staggered draw-on entrance animation on first open. Drag-from-port wire creation with live preview and accent-color glow. Independent pan/zoom with its own major/minor line grid (v3.6.6 — was a dot grid in v3.6.5, changed to match what was actually asked for and to visually differentiate from Board View), eased camera moves for fit-all/reset (cancellable, decoupled from the separately-optimized instant wheel-zoom/drag-pan path). Right-click context menu per node. Keyboard delegation (blocks board-specific shortcuts when active). Runtime self-diagnostic checks port alignment on both axes, scheduled via `requestIdleCallback` (v3.6.6) rather than a fixed delay so it never contends with in-flight animations for layout. |
| `shortcuts.js` | 206 | Global keyboard shortcut handling. Shortcut order: file ops → undo/redo → global (T, ?, M) → map delegation (blocks board shortcuts when map active) → board zoom → board card ops. Respects text input focus and OS key-repeat. |
| `ui.js` | 819 | Settings panel with 10+ toggleable options (including Auto-hide toolbar, v3.6.6), About screen, shortcuts-reference overlay, first-run dialog. Persists settings via IPC. Calls `startAutosave()` after settings load. |
| `app.js` | 816 | Renderer entry point: boot sequence, toolbar button wiring, context menu builder (type-aware, shared `positionMenuInViewport()` clamps to viewport, v3.6.8), drag-drop and clipboard-paste handling (share one `gridArrangePos()` helper sized off the real `defaultCardW` setting, v3.6.8), window chrome, dirty/save-state tracking, recovery dialog, Top Mode + the persistent Auto-hide toolbar setting (share one hover-reveal chrome mechanic, reference-counted so either can be on independently; Top Mode's reveal is deliberately more minimal than the setting's, v3.6.8), persistent Top Mode badge. |

**Total**: 7,829 LOC across 16 modules.

## File format (v3.x)

`.kanvaz` files are plain JSON:

```json
{
  "version": "3.6.5",
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

**Legacy (pre-`boards[]`) files (v3.6.5+):** any file predating the
`boards[]` wrapper — a flat shape with `cards` at the top level — is
auto-migrated into a synthetic single board on load instead of being
silently rejected. Before v3.6.5, `loadFromJSON` required `data.boards`
to exist and did nothing at all otherwise (no error), which meant a
genuinely old file could appear to load as a completely empty board
with no explanation. `migrateLegacyShape()` in `boards.js` now detects
the flat shape, wraps it, and surfaces a "migrated automatically" toast
instead. A file matching neither shape still gets an explicit
"File format not recognised" error rather than doing nothing.

## Design conventions
- **Light and dark themes**, both as CSS custom properties in `main.css`
  (toggled via the `L` key or Settings, `data-theme` attribute on
  `<html>`). Text minimum contrast floor: dark theme `#8A8AAC`, light
  theme `#5C5C78` (both ≥4.5:1 against their respective canvas/surface
  colors — brightened in v3.6.5 after the previous values measured
  3.3–3.7:1, failing WCAG AA for body text).
- **Accent color is theme-specific, not shared.** Dark theme accent
  (`#9D7FFF`, violet) and light theme accent (`#2B7FD4`, blue) are
  independent — changed one without assuming it changes the other.
  Any UI element needing an alpha-blended accent color (glows, hover
  backgrounds) should use `--color-accent-rgb` (comma-separated channel
  values) rather than hardcoding an rgba() triple, since raw CSS `var()`
  can't be split into individual rgba() channels.
- **`var` only** — no `const`/`let`/arrow functions/`.forEach()`. Consistency
  choice, enforced across all 16 source files.
- **Six version locations** bumped atomically on every release:
  `package.json`, `boards.js` VERSION, `ui.js` About screen (×2),
  `README.md` build output, `generate_overview_pdf.py` footer.

## Architecture decisions
- **Connections are file-level, not board-level.** A connection can link
  references across boards. `clearAll()` in cards.js does NOT clear
  connections — that's handled at the boards.js level (newBoard, deleteBoard).
- **Autosave writes to a recovery file only** — never to the user's actual
  `.kanvaz` file. This preserves the "Don't Save" choice in the close dialog.
  The recovery file is cleared on every clean-close path (v3.6.5) — before
  that, it was only cleared after the user answered the recovery-restore
  dialog, so a routine ~30s autosave tick before a perfectly normal close
  left a stale file behind, causing "Recover unsaved board?" to fire on
  nearly every subsequent launch even with nothing actually lost.
- **Both views share the identical major/minor line-grid algorithm**
  (v3.6.7 — Board View was dots until then, Map View got lines first in
  v3.6.6). A bold line every 5th cell, the node-editor "blueprint" look.
  Implemented as two separate copies rather than a shared cross-module
  call, since the two views have independent `tx`/`ty`/`scale`
  closures — but kept byte-for-byte identical so they stay visually
  consistent; any tuning to one should be mirrored to the other.
  Map View's redraw also skips repainting if `tx`/`ty`/`scale` haven't
  changed since the last frame (v3.6.6).
- **Grid lines fade by density, not a hard spacing cutoff (v3.6.8).**
  Earlier versions just stopped drawing minor lines below a fixed
  spacing (4px), which was far too late — lines packed closer than
  ~12px apart have overlapping anti-aliased edges that visually merge
  into a wash, reported as "the grid goes white when zooming out."
  Confirmed and fixed empirically: rendered the grid headlessly at every
  zoom level and measured actual pixel brightness before and after: it
  climbed 21→155 (visibly whitening) under the old cutoff, and now
  peaks at 60 and smoothly returns to 0 as you zoom out further. Minor
  lines fade 20px→12px spacing, major lines 40px→24px, independently.
- **`diagnose()` runs on browser idle, not a fixed delay.** Map View's
  runtime self-check forces synchronous layout (`getBoundingClientRect`
  per node) to compare math-predicted vs. actual port position. A flat
  30ms post-render delay (pre-v3.6.6) landed inside the ~480ms eased
  camera tween and staggered entrance animations, causing visible
  layout-thrashing jank right when opening/zooming Map View. Now
  scheduled via `requestIdleCallback` (600ms `setTimeout` fallback) so
  it only runs once nothing else is animating.
- **Top Mode and the "Auto-hide toolbar" setting share one hover-reveal
  mechanic, independently toggleable (v3.6.6).** Top Mode
  (`Tab`, or `Ctrl+Shift+F`) is a shortcut-gated presentation mode that
  also hides the statusbar; the Settings toggle is a standing
  preference that only affects `#top-chrome`. Both drive the same
  underlying DOM machinery (hover zone, reveal/hide classes, relaxed
  window-size floor) via a combined `chromeAutoHideActive()` check —
  turning one off only tears
  down the shared machinery once *both* are off, so they don't fight
  each other if a user has both enabled.
- **Camera moves are split into two deliberately different code paths.**
  Continuous, direct-manipulation zoom/pan (mouse wheel, drag) stays
  instant with no easing — that path was already tuned jank-free in an
  earlier lag fix, and easing it risks reintroducing the lag. Discrete,
  one-shot camera jumps (fit-all on open, `0`-key reset) use a separate
  cancellable `requestAnimationFrame` tween — cancelled immediately by
  any real user input so it never fights direct manipulation.
- **Mass file drops and clipboard pastes grid-arrange instead of
  cascading.** Both are placed in a `ceil(sqrt(n))`-column grid in
  drop/paste order via a single shared `gridArrangePos()` helper
  (v3.6.6) — earlier versions used a fixed 24px diagonal offset per
  item, which barely separated cards (~200-300px), so a batch of more
  than a few files visually stacked on top of each other. v3.6.5 fixed
  this for drag-drop only; v3.6.6 found paste had the identical bug
  independently and unified both onto one helper so they can't drift
  out of sync again. v3.6.8: the helper's own spacing constant (220px)
  was still too small — real cards default to 600px wide (configurable
  up to 1200px via `defaultCardW`), so anything wider than 220px still
  overlapped despite technically having distinct coordinates. Now
  reads the actual `defaultCardW` setting instead of a guessed
  constant.
- **Map View shortcuts are isolated.** When map view is active, all board-
  specific shortcuts (zoom, delete, nudge, flip, etc.) are blocked to
  prevent invisible modifications to the hidden board canvas.
- **Video cards use deferred playback.** `vid.onloadeddata` triggers play
  instead of `autoplay` to prevent corrupt partial display on slow loads
  or unsupported codecs.
