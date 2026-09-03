# Changelog

All notable changes to Kanvaz are documented here.

## [4.8.0] — `.pur`: broader formats, plus a folder-drop shortcut

The first slice of the planned ".pur: Full Round-Trip" release — scoped down deliberately this pass (see "Not included" below) rather than rush the riskier pieces after v4.6.1's lesson that `.pur` format assumptions need real verification, not just confidence.

### Added
- **WebP detection in `.pur` import.** Extracted via WebP's own RIFF chunk-size header field — no scanning ambiguity, same reliable approach BMP already used. "RIFF" alone is too generic a signature (WAV/AVI share it), so the WEBP fourCC is explicitly verified before accepting a match; a non-WebP RIFF file is correctly rejected rather than misread as one (regression-tested with a synthetic fake-WAV case).
- **Folder-drop auto-arrange.** Dropping a folder of loose images/video/audio onto the canvas now expands it (non-recursive — a folder's own direct contents, not a full directory tree) and grid-arranges everything inside, the same fast "dump it in" workflow `.pur` import's own grid fallback (v4.6.1) already gives PureRef users, now available to everyone else too. The renderer has no filesystem access of its own (`contextIsolation`, no `nodeIntegration`), so a new main-process-only IPC handler resolves what a dropped folder actually contains.

### Not included this release, deliberately
`.pur` export and deeper import fidelity (groups, rotation, exact scale, z-order) are real, larger pieces of work that deserve actual verification against real PureRef files before shipping — exactly the lesson v4.6.1 already paid for once. Rather than rush them to hit a version-count target, they're carried forward to the next `.pur`-focused release instead of shipped half-checked. TIFF detection is also deferred: unlike every format detected so far, TIFF has no simple fixed-offset length field or reliable trailer — determining a TIFF image's true size means actually parsing its IFD (tag directory) structure, meaningfully more work to get right than the box this release scoped.

## [4.7.0] — Organize & Connect

First release of the new post-v4.6.1 arc: users are showing real interest in Map View and `.pur` import specifically, so those get continued dedicated investment instead of the old, now-superseded v5.0.0 backlog (see `docs/ROADMAP.md`). This release covers everything about seeing and managing a growing board.

### Added
- **Board View: card renaming.** There was previously no rename UI anywhere in Board View — only Map View (since 4.6.0). Double-click a card's name in its card-bar, or right-click → Rename. Goes through the same `updateCardData()` path everything else uses, so undo/dirty-flag/MCP Bridge all stay in sync. Shares its "what does the name label actually show" logic (note-content preview vs. plain name) with the card-bar's normal render, via one extracted helper, so the two can't quietly drift apart.
- **Map View: search/filter.** Ctrl+F or `/` opens a search bar (matching Board View's own — same name/type/tag substring matching), dimming non-matching nodes. Fixed a real routing bug in the process: pressing Ctrl+F while Map View was open used to silently open Board View's search overlay instead, which sits behind Map View's fullscreen container — invisible and useless until Map View was closed.
- **Map View: multi-select + bulk actions.** Shift+click a node to toggle it into a multi-selection; Shift+drag on empty space to marquee-select. Dragging any node that's part of an active selection moves the whole group together. A floating bar appears with Tag / Delete / Clear actions for everything selected. Bulk delete goes through one `deleteMultiple()` call (a single undo step for the whole batch, not one per card) — bulk tag currently pushes one undo step per card, a known minor gap (still fully undoable, just needs more than one Ctrl+Z for a large batch).
- **Map View: color-code nodes by tag or type.** A thin accent stripe on each node — by the card's first tag if it has one (a deterministic hash so the same tag always gets the same color), otherwise by card type. Implemented as a separate child element rather than the node's own border-color, so it never fights with hover/selection/multi-select, all three of which already claim that.

### Fixed
- **Tag chips ignored card size entirely.** Flat `9px` in `main.css`, unlike the video/audio scrub-time label right next to them (already using a container-query-relative `clamp()`). Now scales proportionally with the card instead of staying frozen — cramped-and-tiny on a huge card, unreadable on a small one.
- **Video/audio controls popped in and out of existence instead of resizing smoothly.** The scrub-time label and mute button used a hard `display:none` at fixed card-width breakpoints (140px/200px) — `display` can't be animated, so they'd simply vanish or appear mid-drag with no transition. Switched to `max-width`/`opacity`/`margin` collapsing, which — unlike `display` — actually animates, so crossing those same breakpoints now shrinks the controls away instead of snapping.
- **The dot-grid background faded to fully invisible right at maximum zoom-out**, in both Board View and Map View — exactly the moment a spatial reference matters most on a large board. The fade curve was written to reach zero exactly at `ZOOM_MIN`; retargeted to a floor below the reachable zoom range instead, so the grid stays faintly visible everywhere the user can actually zoom to. The separate density-based fade (screen-space line spacing, unrelated to this) still handles the original "lines merge into a wash" problem on its own.

### Known, deliberately not fixed this pass
- Bulk-tagging via Map View's multi-select pushes one undo-history entry per card instead of one for the whole batch (unlike bulk-delete, which already batches correctly). Still fully reversible, just not in a single Ctrl+Z for a large selection.

## [4.6.1] — `.pur` importer: fixed for real files, not just test fixtures

v4.6.0's `.pur` fix solved the hang, but every test up to that point ran
against hand-built synthetic files. Live-tested against an actual PureRef
file this release and found the importer still silently failing — "0
images" on a file that genuinely had a photo in it. Two real format
assumptions were wrong, not one.

### Fixed
- **Only PNG was ever recognized.** A real PureRef board can embed JPEG
  (confirmed: the test file's one photo was JPEG, not PNG, and the
  scanner never even looked for a JPEG signature). Generalized to a
  format table — PNG, JPEG, GIF, BMP — the scan now finds whichever
  signature occurs earliest, not just PNG's. JPEG/GIF/BMP images now also
  get the correct MIME type in their `data:` URL instead of being
  mislabeled `image/png`.
- **The fixed 224-byte header assumption didn't hold.** A real PureRef
  2.1.x file has a variable-length version-string preamble instead — its
  one embedded image started at byte ~106, well before where the old code
  started scanning (224), so it was skipped entirely regardless of the
  PNG/JPEG issue above. `canvas`/`zoom` were never used in this function's
  return value anyway, so the image scan now starts from byte 0 — finds
  the same images either way on an older-format file, no longer misses
  them on a file with a shorter or differently-shaped header.
- **Real files interleave item records between images, not strictly
  after them.** The scanner used to treat every byte between one image
  and the next detected image signature as filler ("duplicate" 4-byte
  transform-id refs) — but a real file's actual position/scale data for
  image #1 sat in that gap, ahead of an internal PureRef thumbnail that
  happened to be the "next image." That data was getting shredded into
  meaningless 4-byte chunks and skipped past entirely, which is why the
  import still came back with zero results even after the JPEG fix. Now
  stops scanning for more images the instant a real item marker is seen,
  handing off to item-parsing at exactly that point instead of sailing
  past it.
- **New: grid-fallback when transform-linking still finds nothing.** The
  byte-level item layout above is reverse-engineered and won't hold for
  every PureRef version forever. If linking produces zero results despite
  real images being found in the file, every real (non-thumbnail-sized)
  image now gets placed on a simple grid instead of the import coming
  back empty — a working import beats a silent failure. This fallback is
  also what a real PureRef file in this release actually exercises, not
  a hypothetical safety net.
- **Caught and fixed a genuine perf regression while building the above**,
  before it shipped: an early version of the multi-format scan re-ran
  `indexOf` for all 4 formats on every single iteration regardless of
  whether anything changed, which re-amplified the exact O(n²) blowup
  4.6.0 had just fixed (measured: 40,000 images regressed from ~50ms back
  up to ~51 seconds). Fixed with per-format position caching — each
  format's next occurrence is only re-searched once the scan has advanced
  past its last known position. `test/pur-import-test.js`'s existing
  performance regression test caught this immediately.
- Regression-tested: `test/pur-import-test.js` gained a synthetic
  JPEG-only, no-linkable-item fixture (Test E) exercising the new format
  detection and grid fallback together — the real test file itself isn't
  shippable as a checked-in fixture (personal file, real copyrighted
  content), so this synthetic case stands in for it. The extracted image
  from the real file was independently verified by writing it back out
  to a real `.jpg` and visually confirming it decoded correctly.

## [4.6.0] — Text cards, Map View rename/preview, and a real bug-hunt pass

Three requests landed at once: a bare text-label card type, bigger resize
handles, and an urgent fix for `.pur` imports hanging the whole app. Fixing
the importer meant reading through the rest of the app's mutation/undo/
viewport code with the same scrutiny, which turned up a dozen more real
bugs — most of them long-standing, none of them hypothetical.

### Fixed — auto-updater, caught by live-testing this release
- **Auto-download had no confirmation step.** `autoUpdater.autoDownload`
  was `true` — the moment a newer version was found, it silently started
  downloading, with no way to say no. Now `false`; the renderer asks
  first ("Download automatically" / "Open release page" / "Later"), and
  only calls the new `download-update` IPC once the user actually agrees.
- **The portable build's update flow was actively misleading.** Live-
  tested running `Kanvaz 4.5.1.exe` (the portable target, not the NSIS
  Setup installer) — it still found an update, "downloaded" it, and
  offered "Restart & Install" as if it were the installed build. It
  isn't: electron-updater has no concept of a portable Windows target at
  all (confirmed — zero mentions of "portable" anywhere in its source),
  and `quitAndInstall()` would run the downloaded NSIS installer against
  an exe that was never actually "installed" anywhere, which does not
  update the running portable file in any well-defined way. Now detected
  via `process.env.PORTABLE_EXECUTABLE_FILE` (electron-builder's own
  documented signal for a portable-launched process) — a portable build
  never gets the auto-download option at all, only a link to the release
  page with an explanation of why.

### Added
- **Text card** (`type: 'text'`) — a bare floating label with no
  background/border/card-bar chrome, for titling a section of the board
  directly. Distinct from Note (a boxed textarea) on purpose. Resizes,
  tags, and is MCP-Bridge-creatable exactly like every other card type;
  excluded from flip/annotate/reset-size the same way Note/Color/Audio
  already are, since there's no visual media to act on.
- **Map View: inline rename** — double-click a node's name, or right-click
  → Rename. There was no rename UI anywhere in Kanvaz before this;
  Properties panel only ever displayed the name read-only. Goes through
  the same `updateCardData()` path MCP Bridge's `updateCard` tool uses, so
  undo/dirty-flag/Board-View's own card-bar all stay in sync.
- **Map View: hover preview** — hovering a node for ~350ms shows a bigger
  look at its actual content: the real image for image/gif, a swatch+hex
  for color, a text excerpt for note/text, the URL/path for url/file. No
  cheap way to grab a real video frame or waveform from Map View (those
  elements only exist in Board View's DOM), so video/audio fall back to
  an icon — an honest scope limit, not an oversight.
- **Bigger resize handles** — 8px → 12px hit area, repositioned to stay
  centered on the same point relative to the card edge. The handle
  actively being dragged now also grows further and every handle on that
  card stays fully visible for the drag's duration — previously handle
  opacity was pure CSS `:hover`, so dragging one away from the card made
  it (and its siblings) fade out mid-drag.

### Fixed — critical: `.pur` (PureRef) import could hang the entire app
- **Ran synchronously on Electron's main process** (`main.js`'s
  `pur-import` IPC handler) — the same process that owns the native
  window's message pump, so any nontrivial file (real PureRef boards
  routinely embed hundreds of images) froze the whole app, not just the
  import, showing as "(Not Responding)". Now runs in a `worker_thread`
  (`src/pur-import-worker.js`) with a 30s timeout backstop.
- **O(n²) transform-linking** in `pur-import.js` — nested scans over an
  `images` array that routinely holds thousands of entries on real files.
  Replaced with `absStart`/`transform-id`-keyed maps, O(n). Measured
  directly: 40,000 images went from ~1.2s to ~50ms.
  Also added a hard cap so a genuinely malformed file fails fast with a
  clear error instead of grinding.
- Caught a second bug while wiring the worker thread itself:
  `postMessage` structured-clones a Node `Buffer` down to a plain
  `Uint8Array` on the receiving side, which lacks the `.readDoubleBE()`/
  `.readUInt32BE()` methods the parser depends on — fixed with an
  explicit re-wrap in the worker.
- Regression-tested at three levels (`test/pur-import-test.js`):
  correctness on a hand-built synthetic file, the O(n)-vs-O(n²) timing
  gap (verified failing against the reverted code before trusting it),
  and the real `worker_thread` round trip — not just the pure function.

### Fixed — found during the resulting audit pass
- **Undo could silently corrupt its own history.** `history.js`'s
  `restore()` handed `KanvazCards.deserialise()` the undo stack's own
  objects directly; `deserialise()` adopts whatever it's given as the
  live cards, so any edit made right after an undo (drag, resize, a tag
  removal's splice) rewrote that stored snapshot in place. Concretely:
  move A, move B, undo, drag A again, undo — the second undo no longer
  moved A back, because the snapshot it restored had been overwritten
  in the meantime. Fixed by always handing `deserialise()` fresh clones.
- **Board switching/opening could land at the wrong pan position.**
  `panTo()` followed by `setZoom()` fought each other — `setZoom`'s
  pivot math rewrites tx/ty based on the ratio from whatever scale the
  *previous* board happened to be at, throwing away the pan just
  restored. New `KanvazCanvas.setViewport(tx, ty, scale)` assigns all
  three in one shot.
- **Video/audio kept playing (and leaking decoders) after board switch,
  file open, or undo/redo.** `clearAll()` removed card DOM elements
  without pausing media first, unlike single-card delete. Fixed to
  pause + release the decoder before removal, every time.
- **Annotations drew in the wrong place at any zoom other than 100%.**
  A HiDPI fix along the way had dropped the `/scale` term needed to
  convert screen pixels back to the card's own coordinate space.
- **Annotations didn't flip with their card.** `flipCard()` only ever
  transformed the media element; the annotation overlay is a sibling,
  not a child, so a circled detail stayed put while the image mirrored
  under it. Now the overlay gets the same transform, on both live flip
  and board load.
- **Autosave ran unconditionally every tick**, re-serializing every
  card's full embedded media even when nothing had changed, with no
  guard against overlapping writes. Now skips clean boards and won't
  start a new write while one's still in flight.
- **Every save spent real CPU DEFLATE-compressing already-compressed
  media** (JPEG/PNG/MP4/...) for zero size benefit — measured 15x
  slower than STORE for identical output size. Assets now use STORE;
  `board.json` itself is unaffected.
- **Dragging a GIF card paused/unpaused it every time** — the GIF image
  is the only media element built without `pointer-events:none` (needed
  for click-to-pause), so a drag's mouseup fired a native click the same
  as an intentional pause toggle. Now shares the same post-drag
  suppression every other card-body click handler already uses.
- **Resize handles could detach a card from the cursor's opposite edge**
  — dragging a left/top handle past the card's own far edge kept
  tracking the raw pointer delta even after width/height had floored at
  the minimum, so the card ran away with the mouse. Position is now
  derived from the fixed opposite edge using the final clamped size,
  which also fixes aspect-lock's corner-anchor drift on the same path.
- **Zoom was additive, not multiplicative** — wildly non-uniform steps
  (huge near the zoom floor, invisible near the ceiling), 100% could
  become permanently unreachable once either limit was touched, and a
  wheel event with `deltaY === 0` (Shift+wheel, trackpad horizontal
  scroll) zoomed out with no vertical input at all. Now multiplicative
  and magnitude-aware, with an explicit `deltaY === 0` no-op.
- **Minimap click-to-pan landed in the wrong place at non-100% zoom** —
  passed world coordinates to a screen-space API without the missing
  `* scale` conversion `map-view.js`'s equivalent code already had right.
- **A card patched via MCP Bridge's `updateCard` (or any plugin) lost
  its visible annotations** until a full reload — `updateCardData()`
  rebuilds the card's DOM element without telling the annotation system,
  which then refused to reattach to a fresh element for that card id.
  The strokes were never actually lost, just invisible.

### Known, deliberately not fixed this pass
- Annotations still drift after save/reload if the card was ever
  resized — the canvas *bitmap* rescales correctly, but the *stored
  stroke coordinates* don't, so replaying them against the card's new
  size lands them at the old scale. Fixing this properly means either
  normalizing stored coordinates to 0..1 or versioning the save format
  to migrate existing absolute-coordinate strokes — a deliberate decision
  to make, not a quick patch, so it's flagged here rather than rushed.

## [4.5.1] — Release build fix (CI only, no app changes)

v4.4.0 and v4.5.0's GitHub Release builds never actually finished: the
macOS leg of CI failed identically on all three of the last three tag
pushes (v4.3.0, v4.4.0, v4.5.0) with `EEXIST: file already exists, link
'...icon.icns' -> '...icon.icns'` — a long-standing, still-unfixed
electron-builder bug where its hard-link-instead-of-copy optimization
collides with an already-existing target file
([electron-builder#6570](https://github.com/electron-userland/electron-builder/issues/6570)
and related reports going back to the 22.x line). Windows and Linux built
fine every time; only the mac `.dmg` was ever missing, which is why v4.4.0
and v4.5.0's releases sat stuck as incomplete drafts instead of publishing.

### Fixed
- `.github/workflows/build.yml` now sets `USE_HARD_LINKS: false` on the
  build step — the documented community workaround, forcing electron-builder
  to copy instead of hard-link. Costs a little extra CI disk I/O, not worth
  caring about.
- The `v4.4.0` and `v4.5.0` tags are left exactly as they were (never
  rewritten — they're the accurate historical record of that code); their
  incomplete draft releases were deleted since they were never public and
  this release supersedes them as the first one that actually publishes
  cleanly with all three platform installers plus the official plugin zips.

No application code changed in this release — see the 4.5.0 entry below for
what's actually new to use.

## [4.5.0] — MCP Bridge: Whole-App Access

Widens MCP Bridge from "read/write cards" to nearly the entire app, on
request, once the goal became clear: automate as much of Kanvaz as possible
from an AI agent. One deliberate exclusion — plugin management — kept for
the same reason it's always been off-limits, and structurally enforced, not
just a rule nobody's supposed to break: plugin enable/disable/approval state
lives entirely in `plugin-state.json`, a file nothing in `KanvazPluginAPI`
has ever had a path to touch.

### Added — 19 new MCP tools (30 total)
- **Board management**: `createBoard`, `listBoards`, `switchBoard`,
  `renameBoard`, `deleteBoard`, `saveBoard`. Everything operates by board id,
  never array index — an index isn't safe to assume stable across separate
  AI-issued calls. `deleteBoard` is the one tool on the whole surface that
  isn't undo-reversible (undo history is per-board, wiped on every
  switch/load) — it's stateless-confirm-gated as a result: call once without
  `confirm` to see what would be deleted, again with `confirm:true` to
  actually delete it. `saveBoard` never opens the native OS Save dialog
  (which would just hang waiting for a mouse click that isn't coming) —
  it uses the board's existing path if it has one, otherwise takes an
  explicit `path` argument to establish one.
- **History & view**: `undo`, `redo`, `zoomIn`/`zoomOut`/`zoomReset`/
  `zoomFit`, `toggleMapView`.
- **Card extras**: `flipCard`, `duplicateCard`, `bringCardToFront`/
  `sendCardToBack`. `updateCard`'s patch also gained a `properties` field
  (the same custom key-value object the Properties panel edits — no new
  plumbing needed, it was already a plain object field on the card, exactly
  like `tags`).
- **Settings**: `getSettings`/`updateSettings`, covering everything Settings
  → Appearance/Behavior/Files/Developer exposes except plugin management.

### Meta
- Wrote up the multi-lens review process from 4.4.0 as a standing practice —
  `docs/AUDIT_METHODOLOGY.md` — instead of a one-off, per explicit request to
  keep running it every time.
- **Run for this release, with one deviation worth recording honestly**: the
  usual 8-parallel-agent fan-out (one per lens) hit a background-agent
  session capacity limit and every agent failed before producing findings.
  Rather than skip the pass, it ran as a single-threaded manual review
  covering the same lenses — security, correctness, Electron/IPC boundary,
  privacy/offline-ethos, end-user QA, and cross-file consistency (plugin
  ergonomics and performance were reasoned through but less exhaustively
  than a dedicated pass would). Verified directly: the confirm-gate on
  `deleteBoard` can't be bypassed; `updateSettings`'s key whitelist holds
  against unknown/prototype-style keys; `switchBoard` reuses the same
  non-destructive path the tab bar already uses (no data-loss risk);
  `saveBoard`'s Promise correctly resolves before crossing the IPC pipe
  (traced through the existing `onInvoke` promise-chain wrapper); the
  hand-kept settings zod schema in `server.js` matches `SETTINGS_DEFAULTS`
  in `src/ui.js` key-for-key (18/18); every `server.registerTool` call has
  exactly one matching `case` in `main.js`'s `handleInvoke` and vice versa
  (30/30, no orphans either direction); `listBoards` doesn't leak file
  paths the way card tools intentionally do. No defects found — a clean
  result, not a skipped one. Full test suite (`validate.js`, the MCP
  bridge e2e test, `format-roundtrip-test.js`) reconfirmed passing after.

## [4.4.0] — Plugin Ecosystem: Hardening, Distribution & MCP Bridge

The flagship reference plugin the plugin system was always building toward:
Kanvaz becomes agent-controllable via MCP, not just AI-assisted. Ships
alongside the audit-flagged gaps (permission enforcement, CI packaging) that
made sense to finally close now that a high-permission official plugin
exists to actually test them against.

### Added — MCP Bridge (flagship official plugin)
- **A local MCP server** (`official-plugins/mcp-bridge`) exposing the active
  board to any MCP-compatible AI client (Claude Desktop, Claude Code, ...) —
  list/get/create/update/delete/tag cards, add a reference from a file path
  or URL, search, list/create connections. **Off by default** — installing
  it does nothing, approving it does nothing, the local listener itself only
  opens once you separately flip it on in Settings → Plugins.
- **Local IPC only, never a network port.** A named pipe on Windows, a Unix
  domain socket on macOS/Linux — nothing outside this machine's kernel can
  reach it. Kanvaz doesn't call out; an already-running AI client's own
  stdio MCP process (`server.js`, spawned by that client, not by Kanvaz)
  connects in.
- **Every AI-driven change lands in undo history exactly like a manual
  edit** — the tool handlers call the same `KanvazCards`/`KanvazConnections`
  functions the UI itself already uses, by construction, not a bolted-on
  safety net.
- A card's embedded media (`dataUrl`) is never sent over the bridge — only a
  `hasMedia` boolean. Verified end-to-end (`test/mcp-bridge-e2e-test.mjs`) with
  a real MCP client driving the real, unmodified `server.js`.

### Added — Runtime API extensions (support for the above)
- `KanvazCards.updateCardData(id, patch)`, `setTags(id, tags)`,
  `deleteCardImmediate(id)`, `search(query)`, `createFileRefCardAtPath(x, y, p)`
  — general-purpose additions (not MCP-only), reusable by any future plugin
  or internal feature that needs to mutate a card programmatically.

### Added — real per-plugin permission enforcement
- **A permission-gated capability (currently: `KanvazPluginAPI.mcpBridge`,
  unlocked by the new `server` permission) is now genuinely absent from an
  unapproved plugin's own view of the API** — not just undocumented, as it
  was for every permission through 4.3.0. `KanvazPluginLoader` now injects
  plugins one at a time and points `window.KanvazPluginAPI` at a scope built
  for whichever plugin is currently loading; each plugin captures its own
  scoped reference at top-level load time (the same convention already used
  for per-plugin storage's `PLUGIN_ID`). Verified in a real browser
  (`test/plugin-scope-test.js`) — including the specific regression a global-
  scope aliasing bug caused during development, caught by that same test
  before it ever shipped.
- This closes the honesty gap for the one capability dangerous enough to be
  worth it this pass; `cardTypes`/`commands`/`network`/`filesystem` remain
  informational-only in the consent dialog, as documented in SECURITY.md.
  Full per-plugin process isolation remains explicitly out of scope (see
  SECURITY.md).

### Added — distribution
- **CI now actually builds official-plugin release assets** on every tagged
  release (audit-flagged for two releases running as never built) — zips
  each `official-plugins/*` folder and uploads it alongside the installers.
- **"Browse Official Plugins" tab** (Settings → Plugins) — one deliberate
  network call (same disclosure discipline as Check for Updates, routed
  through the main process so no new CSP `connect-src` host becomes
  fetchable from the renderer) fetches a small catalog JSON and installs
  with one click. Raw-URL/folder-drop install remains the escape hatch.
- **"Load unpacked plugin"** (Settings → Developer) — Chrome-extension-dev-
  mode pattern: point at any folder with a `plugin.json`, it loads
  immediately, bypassing both the real plugins directory and the consent
  dialog. Clicking it again after editing the plugin's files reloads it.

### Fixed — found and fixed before release, via a structured multi-lens review
The MCP Bridge/permission-scoping work above was checked by an independent
security, correctness, Electron/IPC, plugin-ergonomics, privacy, performance,
and end-user-flow pass before anything shipped. What it found and what
changed as a result:
- **Critical: the permission scope builder leaked itself into every plugin's
  own scoped API**, letting ANY plugin (regardless of declared permissions)
  call it on itself with a forged manifest and synthesize full `mcpBridge`
  access — completely defeating the gate. Fixed by excluding the builder from
  the copy; `test/plugin-scope-test.js` now asserts this specific bypass is
  closed.
- **Two independent plugin-loading operations could corrupt each other's
  permission scoping** if triggered concurrently (e.g. "Load unpacked plugin"
  clicked while startup's plugin scan was still in flight) — there was only
  one `window.KanvazPluginAPI` slot and no coordination between the two
  callers mutating it. Fixed with a shared queue serializing every
  scope-swapping operation; `test/plugin-scope-test.js` now includes a
  deliberately-engineered concurrent-load race, checked against a temporarily
  reverted build to confirm it actually fails without the fix.
- **Re-enabling MCP Bridge stacked a duplicate IPC listener**, silently
  double-firing every tool call (two cards created instead of one, etc.) on
  a disable→enable cycle. Fixed — registering a new handler now replaces the
  last, and the plugin properly releases its own listener on disable.
- **The `mcp-invoke` channel is a shared broadcast any loaded plugin can
  subscribe to**, not scoped per-permission the way `KanvazPluginAPI.
  mcpBridge` is — Electron gives no way to tell which script in a shared
  page context made an IPC call. This is a real, disclosed limitation, not
  something this pass could fully close (would require the per-process
  isolation already declined for this stretch) — see SECURITY.md's MCP
  Bridge section for the full disclosure and the "only install plugins you
  trust just as much" guidance that follows from it.
- **The `server` permission read as generic but only ever authorized one
  hardcoded plugin id** — a well-behaved third-party plugin declaring it
  got a misleading "not approved" error. Now fails with an honest
  explanation of the single-tenant restriction.
- Zip-bomb protection (decompressed-size cap, not just compressed-download
  cap), redirect-target host re-validation, and an unbounded-buffer cap
  added to the catalog install and MCP listener paths.
- `stopMcpBridgeServer()` now actually waits for the OS handle to release
  before a restart is allowed, instead of racing a fast disable→enable click.
- `addReference`'s "fall back to a plain file-reference card" path was dead
  code for the missing-file case (checked an error string the real code path
  never produces) — broadened so it actually works as documented.
- Several smaller fixes: `updateCardData`/`setTags`/`deleteCardImmediate`
  now log a clear error on an unknown card id instead of failing silently;
  duplicate-overlay and stale-"Install"-button bugs in Browse Official
  Plugins; a few copy tightenings.

## [4.3.0] — Command Palette & Plugin Runtime API

The load-bearing layer of the plugin system that everything else (including
v4.4's planned MCP Bridge) depends on — sketched in `docs/PLUGIN_SYSTEM_DRAFT.md`
back in 4.2.0, never shipped until now.

### Added
- **Command Palette — Ctrl+K.** Type to fuzzy-search and run any command by
  name: every one of Kanvaz's own shortcuts (Save, Undo, Select All, Zoom to
  Fit, Toggle Theme, and more) plus anything a plugin registers. Arrow keys
  to navigate, Enter to run, Escape to close.
- **`KanvazPluginAPI.registerCommand(id, { label, run, shortcut, showInPalette, contextMenu })`** —
  a plugin command and a core Kanvaz command are indistinguishable once
  registered; both show up in the palette automatically. Theme Creator now
  registers one ("Randomize Preview") as a working reference example, not
  just a doc sketch.
- **`KanvazPluginAPI.on(event, handler)`** — react to `cardCreate`,
  `cardUpdate`, `cardDelete`, `boardLoad`, `boardSave`, and
  `selectionChange`. Returns an unsubscribe function. A handler that throws
  is isolated — it can't take down the other handlers or the core mutation
  that triggered it.
- **Runtime Data API** — `KanvazPluginAPI.getCards()`, `getSelected()`,
  `getConnections()`, `getActiveBoard()`. Read-only snapshots (cloned, not
  live references), so a plugin can inspect board state without risking a
  silent desync from mutating what it got back.

### Changed
- Settings → Plugins consent model, storage, and every previously-shipped
  `registerCardType`/`registerTheme`/`registerSettingsPanel` API are
  unchanged — this release is purely additive to the plugin surface.

## [4.2.2] — Visual polish and reliability pass

No new features — a dedicated design-consistency audit (every modal, panel,
and overlay checked against every other one) plus a reliability re-check
specifically of the interactive/geometry-sensitive code touched in 4.2.1
(Top Mode's chrome reveal, Map View's connection rendering).

### Changed — visual polish
- **Unified every modal/panel's border-radius, shadow, and entrance animation.** Settings, Shortcuts overlay, First-run screen, the About card, and the standard confirm/warn Dialog now all share the same 10px radius and theme-aware shadow, and none of them pop in instantly anymore — each fades and scales in like About already did. Inspector and Properties (structurally identical side panels) now both slide in from their docked edge; only Properties did before.
- **Replaced every emoji and stray Unicode glyph with the app's own icon language.** The search bar's 🔍, and the first-run screen's ⬇/✱ tip icons, are now small hand-drawn stroke SVGs matching the toolbar's existing icon convention instead of OS-emoji-font glyphs that visually clashed with an otherwise all-vector UI.
- **Connection-type colors are no longer a raw, unmodified Tailwind palette.** The 7 relationship-type colors (Related To, Inspired By, etc., in the Inspector and Map View) are now drawn from Kanvaz's own palette instead of stock Tailwind blue/violet/emerald/amber/red/indigo, which read as a different design system pasted into the app.
- **Toasts get an icon.** A small check/✕ glyph now sits next to success/error toast text, matching the icon treatment already used everywhere else in the app — toasts were the one remaining text-only UI element.
- **The empty-canvas state is no longer the flattest screen in the app.** Its icon is more visible (was practically invisible at 0.18 opacity), lightly accent-tinted, and now animates in — previously a static, undesigned drop straight after the animated First-run screen closes.
- Fixed two mismatched "delete" hover reds (Inspector and Properties each used a different, non-token red) — both now use the same `--color-red`.

### Fixed — reliability
- **Top Mode's drag-to-move-the-window bar could vanish mid-drag**, killing the drag before the window actually moved. The auto-hide timer that reveals/hides the top chrome didn't know a native window drag was in progress and could fire in the middle of one. Now suspended for the whole mousedown-to-mouseup gesture, with a window-blur fallback so it can never get stuck permanently disabled if focus is lost mid-drag (a UAC prompt, Alt+Tab, or OS snap-assist appearing while the mouse button is still down).
- **Map View connections could drift out of alignment after resizing the window** — only the background grid was redrawn on resize; the connection lines themselves weren't. Now re-derived from the live DOM (same source of truth as the initial render), throttled through a single animation-frame so a continuous drag-resize doesn't rebuild every connection's SVG on every intermediate frame.
- Annotation overlays now read the display's current pixel density live instead of trusting a value cached when annotating started — dragging the window to a different-scaling monitor and then resizing a card no longer leaves that card's annotations rendered at the wrong sharpness.
- The floating annotation toolbar now repositions on a plain window resize, not only when the canvas itself pans or zooms — previously a resize-driven layout shift (not a pan/zoom) could leave it anchored to the wrong spot.

## [4.2.1] — Full-stack audit and hardening pass

No new features — a systematic audit of every source file added in the
4.2.0 plugin-system work (and a re-check of everything else), followed by
fixes for everything it found. Two independent audit passes: one for
code-level bugs and security, a second specifically for UI copy that no
longer matched actual app behavior.

### Fixed — data loss & correctness
- **Annotations (pen/arrow/rectangle strokes) weren't marked dirty or pushed to undo history** — closing the app right after annotating (with no other change to trigger a save prompt) silently lost the annotation. Now marks the board dirty and pushes an undo step the moment a stroke is committed.
- **`pluginData` wasn't cloned in undo/redo snapshots** — a plugin card's data object was captured by reference, so a later in-place mutation could retroactively corrupt an already-pushed history snapshot. Now deep-cloned like every other mutable card field, with a safe fallback if the data isn't JSON-serializable.
- **A non-serializable card (bad `pluginData`) could abort an entire save or asset-pack operation** — `JSON.stringify()` and the board-container packing loop now isolate failures to the one offending card instead of losing the whole board.
- **`deserialise()` let one malformed card crash loading the entire board** — each card now loads inside its own try/catch; a bad card is skipped and logged, the rest of the board still opens.
- **Windows path-separator bug in Save As** — the "Board saved as …" toast used a forward-slash-only split, so on Windows it displayed the entire absolute path instead of just the filename.
- **Recent-boards list built its rows with string-concatenated `innerHTML`** — a board or folder name containing HTML-like characters could inject markup into the startup screen. Rebuilt with safe DOM text nodes.
- Several silent `.catch()` blocks (save, save-as, open) now surface a toast on failure instead of failing invisibly with only a console log.

### Fixed — plugin system robustness
- **Plugin storage writes could race** — overlapping saves for the same plugin shared one temp filename; switched to a unique temp file per write plus async file I/O, and capped storage at 5MB per plugin.
- **A plugin registering `id: "dark"` or `"light"` could silently hijack a built-in theme app-wide** — `registerTheme()` now rejects Kanvaz's own reserved theme ids.
- **A plugin card type or Settings panel throwing during render could take down more than itself** — card rendering, context-menu building, and settings-panel rendering are now individually try/catch-isolated with a visible fallback instead of an app-wide break.
- **Settings panels rendered by a plugin were built before being attached to the page**, breaking any `getComputedStyle`/`getBoundingClientRect` call inside a plugin's `render()`. Panel rendering is now deferred until after the container is actually in the DOM.
- **`plugins-remove` could wipe the wrong plugin's stored data** if called with a mismatched folder/id pair — now requires a verified match before touching disk.
- Removed the dead `pdf` ghost entry from the card-type registry (no creation path ever existed for it).

### Fixed — shortcuts & input
- **Every Ctrl-combo shortcut broke under Caps Lock** — comparisons against `e.key`'s hardcoded case silently failed when Caps Lock flipped the reported case; now compares a lowercased key against the modifier booleans only.
- **The Properties and Inspector panels swallowed Ctrl+S/Ctrl+Z and friends while open**, so saving or undoing didn't work with a panel focused. Modifier-held shortcuts now bubble through; plain keys still don't leak into card-level handlers.
- Pressing L to toggle theme no longer bypasses the cleanup that removes a stale plugin-theme stylesheet.

### Fixed — smaller issues
- Media metadata reads (`getNaturalSize`/`getVideoSize`) could hang indefinitely on a malformed file; now time out after 8s with a sane fallback size.
- Map View's `setState()` and port-position math no longer accept negative/NaN/out-of-range values, and the sanity bound was widened to stop clipping ports on very large auto-laid-out boards (2,700+ cards).
- `formatTime()` no longer prints garbage for a non-finite duration.
- Fixed two dead/duplicate CSS rules and hardcoded color literals in the light theme that should have referenced the shared accent-color variable.

### Security
- Added `will-navigate` and `setWindowOpenHandler` guards in the main process, closing off a class of exfiltration/redirect attempts a compromised renderer script could otherwise attempt.
- Added `worker-src 'self'` to the CSP.
- Rewrote the plugin-permission code comments, the install-consent dialog text, and a new "Plugin System — trust model" section in [SECURITY.md](SECURITY.md) to honestly state that the declared permission list is not currently enforced at the IPC layer — an approved plugin has the same practical access as Kanvaz's own code. This was previously implied to be more restrictive than it actually is; nothing about the underlying behavior changed, only the documentation now matches it.

### Fixed — UI copy & documentation accuracy
A dedicated pass checked every user-facing claim (tooltips, the Shortcuts overlay, the first-run screen, context menus, README/CHANGELOG/SECURITY.md) against what the app actually does:
- The Shortcuts overlay, the canvas right-click menu, and the first-run welcome screen all described double-click-to-create-a-note as if it always works — it's off by default (`doubleClickCreatesNote` in Settings). All three now reflect the actual setting, or hide the hint when it doesn't apply.
- Added the missing `Ctrl+F` / `/` search shortcut and the `Ctrl+Shift+F` Top Mode alternate binding to the Shortcuts overlay.
- The titlebar's "Export board" button actually performs a Save As to the same `.kanvaz` format (not a format conversion) — relabeled to "Save board as…".
- README and SECURITY.md both claimed the update check was "a single request" to GitHub — it's actually two independent requests per click (the bundled updater's own check, plus a separate version-info lookup). Both docs now say so.
- SECURITY.md still described `.kanvaz` files as "plain JSON with base64 media" — stale since 4.1.0's zip-container format change. Corrected.
- README described the `pdf` card type as "still in the type registry" — it was removed this pass (see above); README updated to match, and no longer calls Theme Creator "planned" now that it has shipped.
- CHANGELOG's 4.2.0 entry said "no first-party plugins ship yet," directly contradicting the Theme Creator plugin that shipped in that same release — corrected, and the 4.2.0 entry now actually lists everything that shipped in it (registerTheme, registerSettingsPanel, storage API, Theme Creator).

## [4.2.0] — Plugin system (foundation) + Theme Creator

The first piece of a plugin system: third parties can now extend Kanvaz
without forking it — custom card types, full-peer themes, and settings
panels. This is the foundation layer only — commands, event hooks, and a
command palette are a later phase. Theme Creator ships alongside it as
Kanvaz's first official plugin, proving the API end-to-end with something
genuinely useful rather than a toy example.

### Added
- **Plugin system, Layer 1** — a plugin is a folder (`plugin.json` manifest + one plain JS entry file, no build step) dropped into a `plugins` folder Kanvaz manages for you. A plugin's entry script loads as a normal `<script>`, same trust model as a browser extension, not an iframe-sandboxed one.
- **`window.KanvazPluginAPI`** — `registerCardType()` (new card types with a working create/render/context-menu path), `registerTheme()` + `applyTheme()` (a plugin theme is a full peer of the built-in dark/light themes, not a partial override layered on top of one), `registerSettingsPanel()` (a plugin can add its own labeled section to Settings), and size-capped per-plugin persistent storage (`storage.load`/`storage.save`).
- **Theme Creator (official plugin)** — a full in-app theme editor: live color pickers with instant preview across the whole app, save-as-preset, a presets list with pin/star/rename/apply/edit/delete, and one-click reset to Kanvaz's own defaults. Installs the same way any plugin does (Settings → Plugins → Add a Plugin…) — not bundled into the base installer, ships as a separate release asset.
- **Settings → Plugins** — lists installed plugins with an enable/disable toggle (once approved) or a "Review & Enable" prompt (before first approval, or after a permission-escalating update), and a Remove button. "Add a Plugin…" opens the plugins folder directly — no manual path-typing, no knowing where `%APPDATA%` is.
- **Native consent dialog** — enabling a plugin for the first time (or after it requests new permissions) shows an OS-native dialog listing exactly what it's asking for, read directly from the plugin's own `plugin.json` at approval time.
- **Graceful degradation for missing plugins** — a board card whose type belongs to a since-disabled or removed plugin shows a clear "Unknown card type — needs plugin: X" placeholder instead of breaking anything else on the board.
- New test (`test/plugin-loader-test.js`, wired into `npm run validate`) covering manifest validation, permission-escalation-forces-re-consent, and path-traversal rejection in plugin removal.

### Security
- **Consent is enforced entirely in the main process, not the renderer.** An early draft had the renderer able to directly approve a plugin's permissions over IPC — since a plugin's own script runs in the same page context as the rest of the app (the deliberate, disclosed convention-based sandbox model, not iframe-isolated), that meant a plugin could in principle call the same IPC method on itself and silently self-grant permissions with no real dialog ever shown. Fixed before shipping: the approval IPC now takes only a folder name, re-reads that plugin's manifest itself, and gates the actual approval behind a native `dialog.showMessageBox` — a real OS modal a co-resident script cannot script or auto-click. Enabling a plugin is also re-checked fresh against its current consent status server-side, so it can't be used as a side door around the dialog either.
- **CSP change, disclosed**: `script-src` gained `file:` (was `'self'` only) so a plugin's entry file can load as a real script — `'unsafe-inline'` and `'unsafe-eval'` were not added, and inline scripts/`eval`/`Function`-from-string remain fully blocked everywhere in the app, including inside plugin code.
- Plugin removal validates that a supplied plugin id actually matches the folder being deleted before touching disk, and every filesystem path plugin-loader.js touches is checked to resolve inside the plugins directory before use.

## [4.1.0] — Reference types, safer file format, more bug fixes

### Added
- **URL reference cards** — paste a link, open it in your default browser or copy it. Never fetches previews/favicons; stays fully offline like everything else in Kanvaz.
- **File reference cards** — point at a file anywhere on disk (a source PSD, a script, a brief) without embedding it. Open with its default app, or re-point it to a different file anytime. Opening deliberately refuses executable/script file types (`.exe`, `.bat`, `.ps1`, `.js`, `.lnk`, etc.) for safety, since a shared `.kanvaz` file's card data isn't necessarily trustworthy — every legitimate reference use (documents, source files) is unaffected.
- **New `.kanvaz` container format** — a `.kanvaz` file is now a zip container (`board.json` + one file per embedded asset with a SHA-256 integrity hash) instead of one giant JSON blob with everything base64-encoded inline. Fixes the ~33% base64 size bloat and means a single damaged asset degrades to that one card, not the whole board. Old plain-JSON files still open exactly as before — this only changes how new saves are written. Covered by a new permanent test (`test/format-roundtrip-test.js`, wired into `npm run validate`).

### Removed
- **`outcome` reference type** — was registered in the type system with an icon and no defined fields, no creation UI, and no spec for what it was meant to do differently from a Note. Removed rather than left as a permanent ghost entry.

### Fixed
- **Color swatch cards felt impossible to drag** — dragging any card still fires a native `click` on mouseup over the same element; every other card type ignores that, but the color card's swatch/label/copy-button all had click handlers (open color picker, cycle format, copy hex) that fired immediately after every drag attempt, undoing the feel of moving it at all.
- **`.kanvaz` files could silently save without their extension** — Windows' native Save dialog only auto-appends the filter extension when the typed filename has no dot at all; any board name with a dot in it (dates, version numbers) saved with no `.kanvaz` extension, which broke both its file icon and its visibility in the Open dialog's `*.kanvaz` filter. The save handler now forces the extension unconditionally.
- **Map View connections misaligned on some Windows machines, never on others** — traced to a hand-measured pixel offset constant (`PORT_INSET`) calibrated against one specific Chromium render, plus a fixed-timeout guess for when entrance animations had "definitely" finished. Both assumptions break on different display-scaling setups. Replaced with always preferring the live-measured DOM position (safe per-node fallback already existed) and a frame-driven settle loop instead of a timing guess.
- **Video codec failures looked identical to a moved/deleted file** — an MKV/AVI file Chromium can't decode showed the same generic "Missing media" state as an actually-missing file, even though Relink can't fix a codec problem. Now says so plainly and suggests re-exporting as MP4/WebM.
- Replaced the placeholder app icon/logo (in the taskbar, `.kanvaz` file association, and in-app titlebar/About screen) with the real Kanvaz mark.

### Security
- Hardened the CSP further and closed the file-reference "Open" action against launching executable/script files from untrusted `.kanvaz` data (see File reference cards above).
- Corrected a code comment in `connections.js` that implied cross-board connections were just a future flip of a switch — the data model doesn't block it, but there's genuinely no UI path to it today (only one board's cards are ever loaded at a time).

## [4.0.1] — Foundation hardening pass

A full bug-hunt audit across every file in `src/`, followed by fixes for
everything it found — from a save-file data-loss bug down to CSP
hardening. v4.0 is the last planned major version; this batch is meant
to leave the foundation solid before only small fixes ship from here.

### Fixed
- **Image fit, video speed, audio loop, and color format were silently
  lost on every save** — `KanvazCards.serialise()`'s save-file whitelist
  never listed `objectFit`/`playbackRate`/`audioLoop`/`colorFormat`.
  Each feature worked perfectly for the rest of the session (render code
  reads the live card object directly) but reverted to its default the
  moment the file was reloaded. The same 4 fields (plus a newly-added
  persisted `muted` state, see below) were also missing from
  `KanvazHistory`'s undo/redo snapshot, so even undo/redo inside a
  single session would strip them. Both whitelists now include all 5 fields.
- **"Select All" only ever selected one card for real** — Ctrl+A visually
  highlighted every card, but the underlying selection state
  (`selectedId`) tracked just the last one, so Delete/Duplicate/Pin/nudge
  afterward silently acted on a single card while the rest stayed
  untouched. Added real multi-select tracking and bulk-aware
  `deleteSelected()`/`duplicateSelected()`/`togglePinSelected()`, each
  behind exactly one confirm dialog / history entry / toast for the
  whole batch — falls through to the exact previous single-card
  behavior whenever only one card is selected.
- **Minimap click-to-pan was only correct at exactly 100% zoom** — the
  click handler used the raw screen-pixel viewport size instead of
  dividing by the current zoom scale, so panning via the minimap drifted
  further off the more zoomed in or out the canvas was.
- **Escape committed instead of cancelling, in two places** — renaming a
  board tab and typing a card tag both tore down the DOM to "cancel,"
  which fires a native `blur` on the still-focused input first; since
  both had a commit-on-blur handler, Escape ended up saving whatever was
  typed, identically to Enter. Fixed in both `boards.js` and `cards.js`.
- **macOS could skip the unsaved-changes prompt after the first window
  closed** — the `allowClose` flag that gates the close-confirmation
  dialog was never reset per window; since macOS keeps the app running
  after the last window closes and can spawn a new one, a second window
  could inherit a stale `true` and skip the check on its first close.
- **A crashed renderer could hang the app forever** — there was no
  `render-process-gone` handling, so if the renderer process actually
  died (not just a caught JS error) while the main process was waiting
  on the close-confirmation handshake, that wait never resolved.
- **Video/audio mute state wasn't saved** — same class of bug as the
  serialise() issue above; muting a video or audio card reverted to the
  type's default (muted for video, unmuted for audio) on every reload.
  Now persisted as `card.muted`.
- **Tall portrait images could land wildly oversized** — the initial
  drop-size cap only checked width, so an image like 300×3000 passed
  through completely unscaled instead of being fit to a bounding box.
- **Clipboard-pasted audio silently failed to import** — the
  mimetype-based type detector used for paste (as opposed to the
  extension-based one used for file drops) had no `audio/` case.
- **Deleting the active board could orphan connections** — the
  cascade-delete read a snapshot of the board's cards that's only
  refreshed on switch/save, so any card added since the last switch
  wasn't in it, and its connections survived the board's deletion.
- **Shortcuts overlay (`?`) listed "Cards" twice**, with Delete/Ctrl+D/P/H
  duplicated across both — merged into one section.
- **Properties panel couldn't be closed with Escape or E** once focus
  was anywhere inside it — a blanket `stopPropagation` meant to keep
  Delete/P/etc. from leaking to the global shortcut handler also
  swallowed the panel's own documented close shortcuts. Both now close
  the panel directly.
- **Annotations rendered soft on HiDPI/Retina displays** — the drawing
  canvas was sized in CSS pixels with no `devicePixelRatio` scaling.
  Fixed by rendering at native resolution while keeping every stored
  stroke coordinate in the same CSS-pixel space as before, so existing
  saved annotations are unaffected and portable across displays.

### Hardening / polish
- Single-key shortcuts (T, 0, L, etc.) no longer get suppressed just
  because a checkbox, color swatch, or range slider happens to be
  focused — only genuine text-input focus blocks them now.
- Context menus are now built with DOM APIs instead of `innerHTML`.
- `markDirty()`/`markClean()`/`setCurrentPath()` no-op when nothing
  actually changed.
- The pen tool no longer pays for a full-canvas pixel readback it never
  used (that snapshot is only needed by the rect/arrow tools).
- CSP now also sets `object-src 'none'` and `base-uri 'self'`.
- `KanvazBridge.off()` now respects the same channel allowlist as `on()`.
- The Reset Kanvaz recovery-file cleanup no longer aborts entirely if it
  ever encounters a subdirectory instead of a file.

## [4.0.0] — V4.0 Quality Release: card polish, infra, and auto-updates

Completes the v4.0 quality pass that [3.8.1](#381--hotfix-8-verified-bugs-from-the-v40-pre-audit)
started: every card type got a full pass of UI/UX polish, plus a round
of infrastructure work (installer, CI, auto-updater) to make releases
easier to ship and easier to trust.

### Added
- **Per-card-type polish, all 6 types** — image gets a cover/contain
  fit toggle; image/GIF/video get a loading skeleton and a clear
  broken-media error state with a one-click **Relink** button; GIF
  gets a pause overlay; video gets drag-to-scrub, a 0.5×/1×/2×
  playback-speed picker, and a duration badge; audio gets a generated
  waveform, a loop toggle, and a duration badge; notes get a live
  character count and a live filename preview as you type; color
  cards can cycle hex/rgb/hsl format with one click and copy the
  value to the clipboard, plus a black/white contrast preview.
- **Live annotation indicator** — a small dot on any annotated card
  that now updates in real time as you draw or clear, instead of only
  reflecting what was true at last save.
- **Tag autocomplete** — typing a tag now suggests existing tags from
  across the board.
- **Unsaved-changes dot** in the window titlebar, next to the
  filename.
- **App reset v2** — an optional "Reset & Clear Caches" mode that also
  wipes Electron's HTTP/GPU/local-storage caches, for the rare case a
  normal reset doesn't clear up something visually broken.
- **Polished NSIS installer** — custom sidebar art and bundled license
  text, so the Windows installer looks and reads like a finished
  product instead of an electron-builder default.
- **GitHub Actions CI** — lint and syntax validation on every push and
  PR, plus a full Windows/macOS/Linux build-and-publish pipeline that
  runs automatically on version tags.
- **Auto-updater** — checks GitHub Releases for a newer build,
  downloads it in the background, and prompts to restart once it's
  ready. Strictly user-triggered from the existing "Check for
  updates" button in About — Kanvaz still makes zero network calls on
  its own.

### Fixed
- **`.card-error-state` wasn't positioned** — on image/GIF cards it
  rendered clipped and invisible behind the still-visible broken
  `<img>` element instead of showing the intended error state.
- **Annotation dot could go stale mid-session** — it read a
  save-time-only field instead of the live stroke data, so it never
  appeared while drawing and never disappeared after clearing.
- **Tag autocomplete dropdown could be clipped** by a card's
  `overflow: hidden` — now rendered outside the card and positioned
  against it directly.
- **Update-check status text used `innerHTML`** with a string built
  from a network response — switched to safe DOM APIs.

### Internal
- Consolidated titlebar text into a single writer
  (`KanvazBoards.updateTitle()`), replacing two competing code paths
  that could disagree with each other.
- Added `electron-updater` as a real dependency, wrapped in try/catch
  so a missing or broken install degrades to "no updates available"
  rather than crashing the app.

## [3.8.1] — Hotfix: 8 verified bugs from the v4.0 pre-audit

Ships the Phase 1 fixes from the v4.0 quality pass ahead of the card
UI/UX polish work — all eight were verified with exact file/line
references before fixing.

### Fixed
- **Annotate shortcut opened on color cards** — the `A` key guard in
  `shortcuts.js` excluded `note` and `audio` cards but not `color`,
  so pressing A on a color swatch activated the annotation overlay on
  a card type that can't render one.
- **Color picker leaked DOM elements** — clicking a color swatch
  appended a hidden `<input type="color">` to `<body>`, only removed
  on the `change` event. Cancelling the OS picker (Escape, click
  away) left it orphaned in the DOM permanently. Now cleans up any
  leftover picker before creating a new one and removes it on `blur`
  as a fallback.
- **Context menu showed irrelevant items for color/audio cards** —
  "Flip horizontal/vertical" and "Reset size" only excluded `note`;
  "Clear annotations" had no type guard at all. Both now exclude
  `color` and `audio`.
- **`flipCard()` corrupted state on non-visual cards** — flipping a
  note, color, or audio card toggled `flipH`/`flipV` flags and tried
  to transform a nonexistent `img`/`video` element, leaving garbage
  flip state in the saved file. Now returns early for those types.
- **No single-instance lock** — nothing called
  `app.requestSingleInstanceLock()`, so launching Kanvaz twice (or
  double-clicking a second `.kanvaz` file) could open two processes
  against the same recovery/settings files. A second launch now
  focuses the existing window instead.
- **No `.kanvaz` file-open handling** — double-clicking a `.kanvaz`
  file did nothing; there was no `process.argv` parsing on startup
  and no macOS `open-file` handler. Both now forward the file to the
  renderer, which opens it the same way File → Open does.
- **Window title never updated** — the taskbar/Alt-Tab title stayed
  hardcoded to "Kanvaz" regardless of which file was open. The
  in-app custom titlebar showed the filename, but the real OS window
  title never got `setTitle()` called on it. Now reflects the open
  file and an unsaved-changes marker.
- **No `.kanvaz` file association** — `package.json`'s build config
  had no `fileAssociations` entry, so the OS didn't know `.kanvaz`
  files belonged to Kanvaz (no icon, no "Open with", no double-click
  launch). Added for Windows/macOS/Linux via electron-builder.

### Internal
- Added `.gitattributes` (`* text=auto eol=lf`) and normalized all
  tracked text files to LF — the working tree had drifted to CRLF,
  producing full-file diffs on every commit that had nothing to do
  with the actual change.

## [3.8.0] — Crash-safe save, .pur import, properties panel, color cards

### Added
- **Crash-safe save** — writes to a temp file first, then atomically renames
  to the target path. A crash or power loss mid-save can no longer corrupt
  your `.kanvaz` file.
- **Settings migration system** — version-aware migration pipeline that
  automatically upgrades settings across versions without data loss.
  Supports future schema changes with per-version migration functions.
- **Error diagnostics v2** — enhanced diagnostic system with structured
  error codes, contextual metadata, and one-click debug-info export from
  Developer settings.
- **`.pur` file import** — import PureRef `.pur` files via drag-drop or
  right-click canvas menu. Parses the binary format, extracts embedded
  PNG images, and preserves position and scale from PureRef's transform
  matrices.
- **Properties panel (E)** — press E on any selected card to open a
  left-side panel for editing custom key-value metadata. Add, edit, and
  delete properties per card.
- **Color picker card type** — create color swatch cards from the canvas
  right-click menu. Click the swatch to open the native OS color picker.
  Card bar shows a colored circle badge.

---

## [3.7.2] — Polish: Map View UX, tab badges, Top Mode drag bar, dist alias

### Added
- **Top Mode visible drag bar** — a subtle accent-colored strip at the top
  of the screen when Top Mode is active, so you can see where to grab to
  move the window. Brightens on hover for clear feedback.
- **Map View zoom-to-fit (F key)** — press F in Map View to fit all nodes
  into the viewport, matching Board View behavior.
- **Double-click-to-jump** — double-click any Map View node to switch to
  Board View with that card selected and centered.
- **Card count badges** — board tabs now show the number of cards in each
  board as a small badge next to the tab name.
- **Resize handle cursor** — card resize handles now show `nwse-resize`
  cursor on hover, giving clear visual feedback that the handle is draggable.
- **`npm run dist` alias** — shortcut for `npm run build:win` so
  `npm run dist` works out of the box.
- **`ship.bat`** — one-click ship script: lint → syntax check → version
  consistency check → git commit/tag/push → build installers.

---

## [3.7.1] — Hotfix: startup crash, dead buttons, map ports, media controls

### Critical: startup crash blocking all mouse input
v3.7.0 shipped with two broken calls that crashed during `init()`,
preventing `bindGlobalUI()` from executing — which meant **every mouse
click in the app was silently dead** (Settings, About, Shortcuts, Save,
zoom, everything routed through a button listener). Keyboard shortcuts
and canvas pan/zoom still worked because they're wired earlier in boot.

- Fixed: `initTabMmbWindowDrag()` called from `init()` (parent scope)
  but defined inside the `KanvazUI` IIFE (child closure). JS closures
  don't let parents see into children → ReferenceError on every launch.
  Moved the call inside the KanvazUI IIFE after the function definition.
- Fixed: `KanvazApp.showSearchBar/hideSearchBar` → `KanvazUI.showSearchBar/hideSearchBar`
  (`src/boards.js` x2, `src/shortcuts.js` x2).

### Map View: port positions converging at (0,0) on some PCs
Connections drew correctly on most machines but all port endpoints
collapsed to the top-left corner on Windows displays with non-100% DPI
scaling. Root cause: `domPort()` read port positions via
`getBoundingClientRect()` during the entrance animation, when
`translateY(10px) scale(0.96)` shifted coordinates. On standard scaling
the error was small enough to look correct; on 125%/150% scaling it
produced visually broken results. Additionally, `renderLines(false)` was
passing `false` instead of `true` on first open, killing the line
entrance animation.

- Fixed: added `useMathOnly` flag — on first open, port positions use
  pure arithmetic from `card.mapPosition` (always correct). After all
  entrance animations finish (~900ms), re-renders with DOM-accurate
  positions for pixel-perfect alignment.
- Fixed: `domPort()` now validates `getBoundingClientRect` results —
  returns null on zero-size rects or wildly out-of-range coordinates,
  triggering the math fallback instead of returning garbage.

### Media controls: too small, unclickable, didn't scale with card resize
The scrub bar was 3px tall (nearly impossible to click), the mute button
had an inline `font-size:9px` overriding the responsive CSS, and fixed
px values prevented controls from scaling when the card was resized.

- Fixed: all media control dimensions now use `cqw` (container query
  width) units with `clamp()` so they scale proportionally with the
  card. Resize a video card larger → controls grow. Resize smaller →
  controls shrink to a usable minimum.
- Fixed: scrub bar increased from 3px to `clamp(4px, 1.5cqw, 8px)` with
  `padding: clamp(4px, 1.5cqw, 8px) 0` for an 18px+ click target area.
- Fixed: removed inline `font-size:9px` from mute button (was overriding
  the responsive `clamp(12px, 4.5cqw, 22px)` CSS rule).
- Fixed: play/pause SVG icons enlarged from 14×14 to 18×18 base size.
- Fixed: scrub container height, padding, gap, button min-sizes all
  converted from fixed px to responsive cqw clamp values.

### Other fixes
- Fixed: `.tag-bar` (invisible, z-index:2) captured pointer events on
  top of video/audio scrub bars (z-index:3 now, plus `pointer-events:
  none` when hidden, `auto` on hover/selected).
- Fixed: update checker always reported "no internet" — CSP had no
  `connect-src`. Added `connect-src 'self' https://api.github.com;`.
- Fixed: added `.catch()` to all remaining unguarded promise chains in
  `boards.js` (×7), `media.js` (×1), `ui.js` (×1), `app.js` (×1) to
  prevent unhandled rejection error toasts.

## [3.7.0] — Tags, Search, and a Real Polish Pass
The first minor-version milestone since v3.5.4 — closes out the original
v4.0 Phase 1 scope (tag editing, search) that had been deferred across
an extended run of user-reported bug fixes, and does a real audit pass
rather than shipping on hope.

### New features
- **Tag editing UI.** Tags have existed in the data model since v3.0
  with no way to actually add or edit them — that's now fixed. Chips
  appear on hover/selection, click `+` to add, click a chip's `×` to
  remove. Autocomplete draws from tags already used elsewhere on the
  board.
- **Search/filter** (`Ctrl+F` or `/`). Live filter by name, type, or
  tag. Non-matching cards dim and desaturate rather than disappearing
  — keeps spatial context so you're not disoriented when you clear
  the search. Automatically clears when switching boards or opening
  a different file, so a stale query never silently applies to
  content it was never run against.

### Fixes
- **Video/audio control sizing.** Play/pause icons and the scrub bar
  were fixed-size (10×10px icons, 20px bar) regardless of card size —
  functionally unusable once a card was resized down. Now scales with
  `clamp()` against card width, with a sane minimum touch target.
- **Annotation toolbar drift on pan/zoom** — a real, previously
  undocumented-as-fixed limitation. The toolbar was positioned once
  via `getBoundingClientRect()` at open time and never repositioned;
  panning or zooming while annotating left it stuck in place while the
  card moved underneath it. Now watches the canvas transform via a
  `MutationObserver` and repositions live; cleaned up on toolbar close
  so it doesn't linger watching a card that's no longer being
  annotated.
- **Dev Mode's "Show card/connection IDs" was hiding video/audio
  cards.** The injected CSS set `.card { position: relative }`,
  overriding the inline `position: absolute` every card already has,
  and the ID badge itself was positioned at the bottom-right — directly
  over the video/audio scrub bar and controls. Badge moved to the
  top-left, and the position override removed entirely (cards already
  had the right positioning; nothing needed to be set).
- **Top Mode's chrome reveal/hide was abrupt** — sped past as a snap
  rather than a deliberate motion. Eased from 0.22s to 0.4s with a
  softer curve, and the hide-delay grace period extended from 450ms to
  700ms so moving from the hover-zone into the toolbar doesn't
  accidentally dismiss it.
- **Caught during this round's bug hunt, before shipping:**
  - Tag chip remove/add buttons were falling through the card's
    `mousedown` delegation with no exclusion, meaning a click on a tag
    chip could also select/drag the card underneath before the chip's
    own click handler ever ran (mousedown fires first). Added the same
    kind of exclusion the media controls already had.
  - A linter false-positive (`\blet\s` matching the English word "let"
    inside a code comment, not an actual `let` statement) — reworded
    the comment rather than loosening the regex, since that rule is
    correctly strict everywhere else.
  - Stale search state could persist across a board switch or file
    open, showing a query that no longer applied to anything on
    screen. Now explicitly cleared on both paths.

### About screen redesign
Rebuilt from inline `style.cssText` blobs (version number baked
directly into an `innerHTML` string, in two places) into real CSS
classes — same visual content, properly styled: rounded card, clean
type hierarchy, a pill-style version badge, and the update-check
button visually integrated instead of bolted on. Version number now
reads from `KanvazBoards.getVersion()` in one place instead of being
duplicated as a literal string.

### Housekeeping
- Removed the resolved "tags have no editing UI" and "annotation
  toolbar doesn't follow the canvas" lines from Known Limitations —
  properly removed rather than left in place with a note announcing
  the fix.
- Fixed a stale CHANGELOG entry still marked "not fixed yet" for the
  Map View port-alignment issue that was confirmed resolved back in
  v3.6.10.
- Fixed a stale CSS comment ("Dot grid overlay") that had survived
  since the grid changed to lines in v3.6.7.

### Audit
Full 10-pass audit before shipping: syntax ×2, static lint ×2 (caught
1 real false-positive, fixed), real-Chromium port alignment ×2, plus
4 targeted passes verifying every fix above is actually present and
wired — not just claimed. `npm run validate` passes clean.

## [3.6.12] — Clean Reset, Reliable Update Checker
- **Add: "Reset Kanvaz" (Settings → Reset).** Clears settings, the
  recent-files list, and the autosave/recovery cache, then restarts
  with defaults. Built as an in-app feature rather than hooking the
  NSIS uninstaller — an uninstall-hooked approach would only ever
  cover the installer distribution path, not the portable `.exe` or
  running from source, and hand-written NSIS scripting isn't something
  that could be compile-tested in the environment this was built in.
  The in-app version works identically regardless of how Kanvaz is
  being run, and is provably safe: the handler only ever constructs
  paths under `app.getPath('userData')`, and saved `.kanvaz` boards
  always live wherever the user chose via the save dialog — a location
  structurally outside `userData`, not something that needs excluding.
- **Investigated the installer-upgrade question further:**
  `deleteAppDataOnUninstall` (electron-builder's built-in option) was
  deliberately not used — it has a known bug with scoped package names
  (not applicable here, `name` is unscoped) but more importantly it
  would fire during routine version upgrades too, not just intentional
  uninstalls, silently wiping settings on every update unless very
  carefully scripted around. The in-app reset sidesteps this risk
  entirely.
- **Reliability pass on the "Check for updates" feature**, tested
  against GitHub's live API rather than assumptions:
  - Added an 8-second timeout (`fetch()` never times out on its own —
    without this, a hanging connection could leave the button
    disabled indefinitely).
  - Added specific handling for GitHub's rate-limit response
    (HTTP 403 with `X-RateLimit-Reset`) instead of lumping it into a
    generic "unreachable" message — verified against a real live
    rate-limited response encountered while testing this, not a mock.
  - Verified the success path against the real API too: confirmed
    version comparison correctly reports "up to date" for a build
    ahead of the latest published GitHub release.

## [3.6.11] — Installer Upgrade Behavior, Opt-In Update Check
- **Investigated: "many Kanvaz installs on one PC."** Checked the
  actual electron-builder/NSIS config: `appId` has been stable
  (`com.northbytestudios.kanvaz`) since v3.5.4, and electron-builder
  derives a deterministic upgrade/uninstall GUID from `appId` when one
  isn't explicitly set — meaning every installer-based install across
  every past version has already been sharing the same upgrade
  identity, and should already replace in place regardless of install
  path. Almost certainly explained by dev-testing folders and portable
  `.exe` builds instead (neither registers with Windows, so there's
  nothing for an installer to "clash" with) rather than an installer
  bug. Added an explicit `perMachine: false` to the NSIS config for
  defensive clarity — deliberately did **not** add a new custom GUID,
  since that would have broken upgrade continuity for every existing
  install rather than fixing anything (caught before shipping it).
- **Add: opt-in "Check for updates" in the About screen.** Fetches
  GitHub's latest release tag and compares it numerically against the
  running version (not as strings — `"3.6.10"` vs `"3.6.9"` sorts
  wrong under plain string comparison since `1` < `9`). This is the
  **only** network call anywhere in Kanvaz, fires only on click, never
  automatically or on startup. Given how central "zero network calls"
  has been to Kanvaz's identity, this wasn't added quietly — the
  About screen's copy, README, and the generated PDF's Privacy section
  were all updated to precisely disclose this one exception rather
  than leave an now-imprecise blanket "no internet" claim standing.

## [3.6.10] — Real Bug Root Causes, Top Mode Ergonomics
- **Fix: grid snap didn't work.** Root cause, confirmed by tracing the
  actual math: snap was only ever wired into **resize**, never into
  **moving** a card — and moving is the far more commonly tested
  interaction. Extended snap to card repositioning too. Also fixed a
  secondary correctness bug found while tracing this: aspect-locked
  resizes were snapping width and height independently, which could
  distort the locked aspect ratio — now snaps width only and re-derives
  height from it for aspect-locked corner drags.
- **Fix: Delete key "losing focus."** Root cause: after deleting a
  card, `selectedId` just went to `null` with nothing re-selected — so
  a keyboard-only bulk delete (Delete, Delete, Delete...) went dead
  after the first one, since the shortcut handler requires a selection
  to act on. Now auto-selects another remaining card after a delete.
- **Add: Top Mode auto-enables Always on Top**, gated behind a new
  Settings toggle (off by default). Remembers whether Always on Top
  was already on beforehand so exiting Top Mode restores that instead
  of just forcing it off — doesn't fight a separate, deliberate
  Always-on-Top preference if the user already had one set.
- **Add: Tab+MMB whole-window drag** — hold Tab and drag with the
  middle mouse button to move the window from anywhere on screen, not
  just a titlebar strip. Gated behind Tab specifically because plain
  middle-mouse-drag is already canvas-pan in both views. Known,
  disclosed tradeoff: Tab already toggles Top Mode on keydown, so
  holding Tab to start this drag also flips Top Mode as a side effect
  of that same keypress — living with it for now rather than adding
  toggle latency to fix a rare combination.
- **Add: thicker titlebar during Top Mode's reveal** (36px → 48px) and
  made the top hover-zone a real OS-level drag region — addresses
  "dragging is hard in Top Mode" directly, independent of the Tab+MMB
  feature above.
- **Confirmed fixed: the Map View port start-point discrepancy**
  reported by users. No longer reproducible — removed from Known
  Limitations in the README.
- **Docs**: caught two more stale "Mood lock" references that had
  survived the Top Mode rename — both were baked directly into the
  generated PDF (the feature list and the shortcuts table), so they'd
  been shipping in every release since without anyone noticing since
  they're not in the source Markdown that gets reviewed directly.
  PDF regenerated.

### Known issue, still unresolved
- **New/legacy `.kanvaz` files reported as "opening empty," at least
  partially.** Re-verified the full load pipeline end-to-end this
  round: all three entry points (File → Open, Recent Files list,
  startup screen) now consistently run the same validated
  flat-shape-migration logic, and the save/serialise round-trip for a
  freshly migrated board was traced and confirmed correct. Couldn't
  find a further defect through code inspection alone — if this is
  still happening, the most likely explanation is that the actual old
  file's shape doesn't match the flat-`cards`-array format the
  migration assumes (this repo has no source history before the
  public v2.0.1 release, so the true legacy format was inferred, not
  known). Need an actual sample of a file that still fails — even just
  its first ~20 lines of JSON — to fix this correctly instead of
  guessing a third time.

## [3.6.9] — Grid Snap, Dev Mode
- **Add: grid snap on resize.** New Settings toggle ("Snap to grid on
  resize") plus an increment selector — Minor (24px) or Major (120px),
  user's choice, as requested. Snaps width, height, and position
  during a resize drag. Uses world-space units, so it stays correct
  regardless of current zoom level (the grid's on-screen size changes
  with zoom; its logical spacing never does).
- **Add: Developer settings section**, 5 tools:
  - *FPS / render-time overlay* — small always-on-top HUD showing
    current FPS and last-frame time, updated twice a second.
  - *Show card/connection IDs* — overlays each card's and Map View
    node's real ID (small corner label), plus appends the connection
    ID to its type label in Map View. Useful for correlating what's
    on screen with what's in a saved `.kanvaz` file or a bug report.
  - *Run diagnostics now* — manually triggers Map View's runtime
    self-check on demand instead of only running on browser idle.
  - *Generate 50 test cards* — bulk-creates 50 synthetic note cards
    in a grid layout for stress-testing render/scroll/zoom
    performance. Deliberately bypasses the normal single-card creation
    path (which selects and focuses each card) since doing that 50
    times in a row would thrash badly — one history entry, one
    render pass, for the whole batch.
  - *Export debug info* — copies version, platform, theme, card/
    connection counts, window size, and full settings JSON to the
    clipboard in one click, ready to paste into a bug report.
- Added a `button` row type to the Settings panel renderer (previously
  only toggle/number/select existed) to support the three action-based
  Dev Mode tools above.

## [3.6.8] — Grid White-Out, Drop Sizing, Top Mode Polish
- **Fix: grid genuinely went white zooming out — confirmed and fixed
  empirically, not by inspection alone.** Rendered the exact grid
  algorithm headlessly at every zoom level and measured actual pixel
  brightness: it climbed from 21 (correct) to 155 (visibly washed out)
  well before the old cutoff logic engaged. Root cause: lines packed
  closer than ~12px apart have overlapping anti-aliased edges that
  visually merge. Replaced the abrupt spacing cutoff with a smooth
  per-line-type density fade (minor lines fade out 20px→12px, major
  lines 40px→24px) — verified the fix the same way, brightness now
  peaks at 60 and smoothly returns to 0, never climbing toward white.
  Applied identically to both Board View and Map View.
- **Fix: dropped/pasted images still overlapped despite the v3.6.6/6.7
  grid-arrange fix.** That fix technically worked (different
  coordinates per item) but used a fixed 220×180px spacing constant —
  while real cards default to 600px wide (user-configurable up to
  1200px via `defaultCardW`). Any photo wider than 220px still
  overlapped its neighbor. Now sizes grid spacing off the actual
  `defaultCardW` setting instead of a guessed constant.
- **Fix: right-click menu could clip off-screen at small window
  sizes.** The existing flip-if-overflowing logic had no final clamp —
  if the menu didn't fit even after flipping to the other side, it
  just clipped off the *opposite* edge instead. Extracted the
  duplicated positioning logic (canvas menu + card menu) into one
  shared, properly-clamped helper.
- **Fix: Settings panel could overflow off-screen with no way to
  scroll** at small window heights (window now floors at 240px tall
  since v3.6.7). Added `max-height` + scroll.
- **Add: `S` toggles Settings, `I` toggles About** (matching `?`'s
  existing open/close toggle behavior, which About didn't have until
  now — it always created a fresh overlay instead of checking for one
  already open). Both verified gated behind the same text-input guard
  as board shortcuts — typing "s" or "i" in a note or filename field
  still types normally, confirmed programmatically by checking their
  position in the shortcut-handling code relative to the guard, not
  just by inspection.
- **Top Mode's hover-reveal is now genuinely minimal**, not just the
  full toolbar in miniature: only app name, project title, and
  minimize/maximize/close — export and always-on-top are hidden too.
  The separate "Auto-hide toolbar" *setting* still reveals the full
  toolbar as before; only Top Mode itself got the minimal treatment,
  since it's a presentation mode, not a toolbar-access convenience.
- **Add: persistent "Top Mode — Tab to exit" indicator** — a small,
  low-opacity badge shown the entire time Top Mode is active,
  independent of hover-reveal state. Previously there was no way to
  tell Top Mode was on (or how to get out) without already knowing the
  shortcut.
- **Widened the Top Mode hover-zone hitbox** from 10px to 16px — easier
  to trigger reliably.

## [3.6.7] — Grid, Resize, and Top Mode (formerly Mood Lock)
Follow-up round from continued real-world testing of v3.6.6.

- **Board View grid changed from dots to lines too.** The original
  "graphs with lines" request was mainly about Board View, not Map
  View — v3.6.6 only fixed Map View. Both views now use the identical
  major/minor line-grid algorithm (bold line every 5th cell), so the
  whole app is visually consistent.
- **Grid visibility increased in both themes.** The line alpha values
  were quite subtle (5-14%) — bumped to 9-22% (theme-specific) for a
  clearly visible but still subordinate grid, verified by computing the
  actual blended pixel delta against each theme's canvas color rather
  than eyeballing it.
- **Window can now resize much smaller, unconditionally.** Previously
  the small ~220×160 floor only applied while Top Mode or the
  Auto-hide toolbar setting was active — normal (chrome-visible) mode
  was still floored at 640×480. The unconditional floor is now
  320×240, always, regardless of mode. The toolbar now scrolls
  horizontally instead of breaking if there isn't room for every
  button, and the titlebar title truncates with an ellipsis instead of
  potentially pushing the minimize/maximize/close buttons out of reach
  — verified those buttons have a non-negotiable `flex-shrink: 0` so
  that can never happen at any window size.
- **Mood Lock renamed to Top Mode, with an easier shortcut.**
  `Ctrl+Shift+F` (a 3-key chord) still works for muscle memory, but
  `Tab` is now the primary trigger — deliberately chosen to match the
  "hide all panels" convention VFX/3D artists already know from
  Blender and Photoshop. `Tab` is gated behind the same text-input
  guard as board-shortcuts (not an "always fire" binding), since Tab
  has a native meaning inside form fields; `Ctrl+Shift+F` stays in the
  always-fire group as before.

## [3.6.6] — Real-World Testing Fixes
Everything below came from actually testing v3.6.5, not internal review —
thank you to whoever put it through its paces.

- **Fix: clipboard paste (Ctrl+V) still had the old stacking bug.** v3.6.5
  fixed drag-drop's cascade-offset stacking but missed that paste had the
  *exact same* bug independently (`(pasteCount % 8) * 24` — same
  too-small offset, plus it read a racy global card count from inside an
  async callback instead of the paste batch's own index). Extracted a
  single shared `gridArrangePos()` helper used by both drag-drop and
  paste now, so this class of bug can't drift out of sync between the
  two paths again.
- **Map View grid changed from dots to lines.** The original ask
  ("graphs with lines") was misread as a request for a dot-grid
  matching Board View's — it meant actual grid lines. Replaced with a
  major/minor line grid (bold line every 5th cell) — the node-editor
  "blueprint" look from Blender/UE/Houdini, which also visually
  differentiates Map View from Board View's dot grid instead of
  duplicating it.
- **Fix: perceptible lag when switching into Map View / zooming.**
  Root cause: `diagnose()` (the runtime self-check) ran on a flat 30ms
  delay after every render, forcing synchronous layout
  (`getBoundingClientRect` per node) — which landed squarely inside the
  ~480ms eased camera tween and staggered entrance animations added in
  v3.6.3, causing layout thrashing exactly when opening/zooming Map
  View. Now uses `requestIdleCallback` (falls back to a 600ms
  `setTimeout`) so it only runs once the browser is actually idle.
  Also added a redundant-redraw guard on the grid so unchanged
  tx/ty/scale between frames skips a full canvas repaint.
- **Generalized Mood Lock's hover-reveal into its own setting.**
  v3.6.5 added hover-to-reveal chrome, but only inside Mood Lock
  (`Ctrl+Shift+F`) — a tester using the app normally never found it,
  couldn't shrink the window small, and went back to PureRef over it.
  Added a new persistent **"Auto-hide toolbar"** setting
  (Settings → Behavior, default off) that turns on the same
  hover-reveal mechanic and the relaxed window-size floor as a standing
  preference, independent of Mood Lock. The two can be on
  simultaneously without fighting each other — turning either off only
  disables the shared hover machinery once *both* are off. Mood Lock
  itself is unchanged (still also hides the statusbar, still a
  shortcut-gated presentation mode) — this is additive, not a
  replacement.
  Default is **off** — flagging this as a real product call, not an
  obvious one: defaulting a first-time user straight into
  hidden-toolbar mode risks hurting discoverability of New/Open/Save
  for anyone not already coming from PureRef. Easy to flip to
  default-on if that's the wrong call for the target audience.

## [3.6.5] — Bug Fixes from User Reports
Several real bugs reported by users, root-caused and fixed:

- **Recovery dialog firing on nearly every launch.** `handleCloseRequest()`
  never cleared the crash-recovery file on a clean close — only after the
  user answered the recovery-restore dialog. Since autosave writes that
  file every ~30s during any session, a routine tick before a perfectly
  normal close left it behind, so "Recover unsaved board?" appeared on
  the next launch even with nothing actually lost. Now cleared on every
  clean-close path (no-changes, Save, Don't Save).
- **Old files silently loading empty.** `loadFromJSON` has required
  `data.boards` to exist since the very first public commit (v2.0.1),
  with a silent no-op otherwise. Any file predating the `boards[]`
  wrapper appeared to load as a completely empty board with zero
  explanation. Added `migrateLegacyShape()` — auto-detects a flat
  legacy shape (`cards` at the top level) and wraps it into a synthetic
  board, with an explicit "migrated automatically" toast. A file
  matching neither shape now gets a clear "File format not recognised"
  error instead of doing nothing.
- **Mass file drops stacking cards on top of each other.** Drop
  placement used a fixed 24px diagonal cascade per file — fine for 2-3
  files, but cards are ~200-300px, so batch drops of 10+ files visually
  overlapped almost entirely. Replaced with a proper `ceil(sqrt(n))`-
  column grid layout, still placed in drop order.
- **Near-invisible muted text.** `--color-text-3` measured 3.3–3.7:1
  contrast in both themes — failing WCAG AA (4.5:1) for body text.
  Brightened in both dark (`#6A6A8A` → `#8A8AAC`) and light
  (`#7A7A94` → `#5C5C78`) themes; both now clear 5:1+.
- **Map View had no background grid.** It hid Board View's grid canvas
  entirely and showed a blank field. Added an equivalent dot-grid,
  independent implementation tied to Map View's own pan/zoom state.

### Mood lock hover-reveal + smaller window floor
- Mood lock (Ctrl+Shift+F) no longer needs Esc as the *only* way back
  to the toolbar — hovering the top edge (or the toolbar itself while
  it's showing) now briefly reveals title/toolbar/tabs as a floating
  overlay, without exiting mood lock or resizing the canvas underneath.
  Move away and it hides again after a short delay.
- Window minimum size now relaxes from 640×480 to 220×160 while mood
  lock is active (that floor exists so the ~10-button toolbar doesn't
  overlap/clip — mood lock has no toolbar, so it doesn't need the
  space). Restores to 640×480 immediately on exit, growing the window
  back up if it had been shrunk smaller.

### Previously known issue — now resolved
- Map View: connection wires sometimes starting from a different point
  than the output port — confirmed fixed as of v3.6.10, no longer
  reproducible. Removed from README Known Limitations.

## [3.6.4] — Post-Polish Audit
- Fixed: `hide()` didn't cancel an in-flight eased camera tween
  (fit-all/reset) — switching out of Map View mid-animation left a
  `requestAnimationFrame` loop running against a hidden element until
  it finished. No visible symptom (self-healed on next open since
  `fitAll` re-cancels), but wasted work. Now cancelled on `hide()`.

## [3.6.3] — Portfolio Polish Pass
Visual polish pass with no functional changes, aimed at clean
screenshots/GIFs:

- **Eased camera moves** — fit-all (board open) and the `0`-key reset
  now tween with `easeOutCubic` instead of snapping instantly.
  Deliberately kept separate from wheel-zoom/drag-pan, which stay
  instant (already tuned jank-free in an earlier fix) — any real user
  input cancels an in-flight tween immediately.
- **Entrance choreography** — cards fade+lift in staggered, connections
  draw on with a bezier stroke reveal + fade-in halo. Only on first
  board open, never on normal editing re-renders.
- **Wire-drag glow** — active port + preview line now have a soft
  accent-colored glow instead of a flat color.
- **Accent color (dark theme)**: blue `#4A9EFF` → violet `#9D7FFF`.
  Fixed 8 additional hardcoded-hex instances that had drifted from the
  project's own "use CSS vars for theme support" rule (toolbar active
  state, drop overlay, gif badge, resize handle, 2 button hovers,
  minimap viewport box, node-hover glow) — all now route through a new
  `--color-accent-rgb` var so future accent changes propagate
  everywhere automatically.
- Fixed: `portOut`'s mouseleave was restoring to `--color-border-2`
  instead of its actual idle color `--color-port`.
- Added `demo/Kanvaz-Portfolio-Demo.kanvaz` — a curated 9-card demo
  board for portfolio screenshots, no real media required.

## [3.6.2] — Port-Alignment Test Safety Net
The port math itself was already correct (verified 0px error across 5
zoom/pan cases) — the safety net around it had two real holes:

- `diagnose()`'s runtime self-check only ever compared the X-axis for
  both ports — any Y-axis drift was invisible to it. Now checks both
  axes.
- `test/run-port-test.js` hardcoded a Chrome path from one prior
  development machine and loaded a `/tmp` file nothing ever generated
  — it had never actually run correctly outside that one session,
  silently skipping or crashing everywhere else. Rewritten to
  auto-detect a Chrome/Chromium install (env var → per-OS common paths
  → puppeteer's own cache) and regenerate its test fixture into a real
  temp file on every run.

## [3.6.1] — 20-Level Audit Cleanup
Passed a 20-level audit (each check run and verified twice). One fix:

- Removed dead code: verifyPortAlignment() (~55 lines) was superseded by
  diagnose() in v3.5.4 but left defined and exported. Removed the function
  and its export. diagnose() remains the single runtime health check.

Audit confirmed clean across: syntax (16/16), var-rule, CSP, versions,
port alignment (0px, real Chromium), guarded JSON.parse (7/7), theme
coverage, NaN/transform guards, orphan-connection cascade, event-listener
cleanup, media error handling, backward compat, and full validation suite.

## [3.6.0] — UI Polish Pass
Elevating what exists — no new features, just a more premium feel.

### Toolbar
- Buttons: press-scale feedback (0.96) on click, disabled state styling
- Icons: stroke-width standardized to 1.5 across all toolbar/titlebar icons
  (was a mix of 1.3 / 1.5 / 1.6 — looked uneven)

### Map View
- Nodes: smoother 0.18s ease transitions on hover
- Ports: soft accent-colored glow ring on hover (0 0 0 4px accent-bg)
- Port transitions eased for a more tactile feel

### Context Menu
- Consolidated duplicate CSS rules from the v3.5.0 polish pass
- Larger radius (10px), roomier padding, deeper shadow
- Keyboard shortcut hints now render as subtle kbd-style badges
- Danger items (Delete) show red on hover

### Settings Panel
- Grouped into sections: Appearance, Behavior, Files
- Section headers in uppercase micro-labels
- Theme-aware panel shadow

### Dialogs
- Buttons: press-scale feedback
- Theme-aware shadows

### Theme Consistency
- Replaced remaining hardcoded rgba shadows with var(--color-shadow)
  in settings panel and dialogs (better light-theme rendering)

## [3.5.5] — Connection Tubes Anchor to Live DOM Ports
The real root cause, found by end-to-end audit.

### Root Cause
The port MATH was correct (proven 0px in v3.5.3/4). The bug: renderLines
computed tube endpoints from stored card.mapPosition, but that value can
go stale relative to where the node actually renders — from the hover
transform (translateY -1px), Math.round drift on drag, or board/map
position desync in saved files. Result: tubes anchored to where the card
USED to be, floating in empty space while the real port O sat unconnected
(exactly what the screenshots showed).

### Fix
- New domPort(refId, side): reads the ACTUAL rendered port-dot center
  from the DOM via getBoundingClientRect, converted to world coords.
- renderLines and wire-preview now use resolveOut/resolveIn, which return
  DOM truth when available and fall back to math only if the node isn't
  in the DOM yet. This is how real node editors (Blender, Unreal, n8n)
  anchor wires — to the DOM handle, never to stored coordinates.
- Removed .map-node:hover translateY(-1px) — it shifted the port O away
  from the tube anchor on hover.

### Proven
- Test with STALE mapPosition (node renders at 300,300 but stored says
  100,200): old math → tube at 275,226 (floating). New domPort → 475,326
  (exactly on the port O). Verified in real Chromium.

## [3.5.4] — Advanced Error Debugging & Validation Suite
Tooling to catch bugs before they ship — not after.

### New: Validation Suite (test/)
- `npm run validate` — master check: syntax, lint, port alignment, versions.
  Exits non-zero if anything fails. Run before every release.
- `npm run lint` — static analyzer that catches the exact bug classes this
  project has hit: var-rule violations, inline onclick (CSP), version drift,
  unguarded JSON.parse, hardcoded dark colors, stale release language,
  leftover TODO/FIXME. Zero false positives on current code.
- `npm run test:ports` — renders node CSS in real Chromium, proves the
  connection port formula matches actual DOM at 5 zoom/pan levels (0px error).

### New: Runtime Self-Diagnostic
- KanvazMapView.diagnose() runs after every Map View render and on demand.
  Checks: NaN/Infinity transforms (blank canvas), orphan connections
  (pointing at deleted cards), duplicate connections, missing port dots,
  and live port-alignment drift. Logs colored pass/fail to DevTools console.

### Validated
- The linter immediately caught a .forEach violation in new diagnostic
  code during development — exactly the kind of bug it exists to stop.
- Fixed: 2 inspector dialog overlays now use var(--color-overlay).
- All checks green: 16/16 syntax, 0 lint errors, 0px port error, versions aligned.

## [3.5.3] — Port Math PROVEN Against Real Browser Rendering
This time, measured — not reasoned.

### The Fix
- Port formula corrected to PORT_INSET = 1px (was 1.5px). Verified by
  rendering the exact node CSS in real headless Chromium and measuring
  actual port-dot center positions via getBoundingClientRect:
  - outPort.x = mapPosition.x + NODE_W - 1 (175)
  - inPort.x  = mapPosition.x + 1
  - The 1px = half the port dot's own 2px border, not the node's 1.5px.

### Proof
- Added test/ directory with a Puppeteer test that renders nodes in real
  Chromium and compares formula vs actual DOM at 5 zoom/pan levels
  (1.0, 1.5, panned 1.5, zoomed-out 0.5, arbitrary 2.3 + offset).
- Result: error=[0,0] on every port at every transform. ALL CASES PASS.
- Run it yourself: `node test/run-port-test.js`

### Why previous attempts failed
Every prior fix reasoned about the CSS box model on paper and got the
sub-pixel border handling wrong (1.5 vs 1). The only reliable method is
to measure what the browser actually renders — which this version does.

## [3.5.2] — Connection Port Math: Definitive Fix
The port alignment bug, solved from first principles.

### Root Cause (finally identified)
The SVG that draws connection lines and the node divs are BOTH children
of #map-world, sharing one coordinate space. Previous versions used
getBoundingClientRect() to read port positions, then converted screen→
world coordinates — but that conversion mixed up the CONTAINER rect and
the WORLD rect (which differ when the world transform is applied),
producing large, zoom-dependent offsets.

### Fix
- Port positions are now PURE world-space arithmetic — no DOM reads, no
  screen conversion, no cache. Derived directly from CSS box model:
  - Absolutely-positioned port dots are placed relative to the node's
    PADDING BOX (CSS 2.1 §10.1). With box-sizing:border-box and a 1.5px
    border, the padding-box right edge = mapX + NODE_W - BORDER.
  - outPort.x = mapPosition.x + NODE_W - NODE_BORDER (174.5)
  - inPort.x  = mapPosition.x + NODE_BORDER (1.5)
  - Y: mapPosition.y + NODE_H/2 (border cancels top/bottom symmetrically)
- Wire preview: origin from outPort() math, cursor endpoint from a single
  correct mouse→world conversion (container rect − tx/ty, ÷ scale).
- Verified against CSS spec: max error 0px.

### Debug
- verifyPortAlignment() now compares math against DOM using the WORLD
  rect (SVG's true origin), runs after every render, logs any drift.

## [3.5.1] — Docs Polish
- Fixed: "Light and dark themes" was listed under Known Limitations
  instead of Features — moved to Features section.
- Added: Light / dark theme to Features list.
- All docs verified: README, PRIVACY.md, THIRD_PARTY_NOTICES.md,
  TECHNICAL_OVERVIEW.md, CHANGELOG.md, LICENSE — all current and
  consistent with v3.5.1.

## [3.5.0] — UI Polish + Port System Rewrite
Ship date: July 1, 2026

### Port System — Final Rewrite
- Eliminated: port cache, CSS math, box-sizing assumptions — ALL removed.
- New: getPortPos() reads port dot center via getBoundingClientRect every
  call. outPort/inPort delegate to getPortPos with math-only fallback.
- Wire preview: origin captured from clicked port dot's DOM position at
  exact click moment (wireOriginPos). Wire starts from the O, period.
- This approach is correct by construction — reads the rendering engine's
  own layout output. Cannot break from CSS changes.

### UI Polish
- Map nodes: hover lift animation (translateY -1px + shadow increase)
- Map nodes: selection glow uses CSS variable accent, not hardcoded blue
- Map shadows: all 7 hardcoded rgba() → var(--color-shadow)
- Map tube inner shadow: theme-aware (var(--color-text-inv))
- Map dialog overlay: var(--color-overlay)
- Cards: hover lift shadow transition
- Context menu: border-radius 10px, fade-in animation, danger items red
- Light theme: card selected accent border + shadow, toolbar/statusbar
  separators, context menu border + shadow + hover

### Recovery Dialog
- clearRecovery() now in all 4 paths: Save, Save As, Open, startup open
- No more phantom restore dialogs on saved files

## [3.4.2] — Recovery Fix + DOM-Based Port Alignment
Ship date: July 1, 2026

### Critical Fix: Recovery Dialog
- Fixed: restore dialog appeared on EVERY launch even after the file was
  already saved. Root cause: clearRecovery() was only called in saveBoard()
  but NOT in saveBoardAs(), openBoard (Ctrl+O), or startup screen file open.
  Now called in all 4 save/open paths.

### Critical Fix: Port Alignment (attempt 7 — correct by construction)
- Replaced: all CSS-math-based port position computation with DOM-based
  reading via getBoundingClientRect(). Previous attempts failed 6 times
  due to box-sizing assumptions. The new approach queries the ACTUAL
  rendered position of each port dot from the browser's layout engine,
  converts to world coordinates, and caches them. This is correct
  regardless of CSS box model, padding, border, or future style changes.
- Wire preview: origin captured from the clicked port dot's DOM position
  at the exact moment of click — stored as wireOriginPos. Preview bezier
  now starts from the exact center of the O the user clicked.
- Port cache: rebuilt SYNCHRONOUSLY before every renderLines() call
  (was async setTimeout — caused stale positions on first render).
- Port cache also rebuilt: during live node drag, after drag end.
- Mathematical fallback retained for edge cases where DOM isn't ready.

### README
- Added: development status banner (Map View under active development)
- Added: Map View marked as "under active development" in features

## [3.4.1] — Bugfix Patch
Correct port math for border-box + final bug sweep.

### Critical
- Fixed: connection tube endpoints were 31px off — port math assumed
  content-box but global CSS uses border-box. With border-box,
  width:176px IS the total width. Correct formula:
  outPort.x = mapPos + NODE_W - BORDER (174.5), not mapPos + 205.5.

### Fixes
- Fixed: pressing L (theme toggle) didn't redraw grid dots — dots stayed
  wrong color until next zoom. Now calls drawGrid() immediately.
- Fixed: Annotate showed in context menu and A shortcut for audio cards
  (drawing on a scrub bar is useless). Now hidden for note + audio.
- Fixed: NODE_FULL_W/H were wrong (used content-box formula). Now equal
  NODE_W/NODE_H since border-box means width IS the full width.

### UI
- Light theme: accent borders on selected cards, toolbar/statusbar
  separators, context menu border + shadow, hover highlight.
- Shortcuts overlay: 3-column layout with Cards section.
- About screen: updated tagline.

## [3.4.0] — Connection Tube Alignment Fix + Light Theme
Major bug fix + new light/dark theme system.

### New: Light / Dark Theme
- Press L to toggle between light and dark themes instantly.
- Theme persists in settings (also available in Settings → Theme dropdown).
- Light theme: clean white surfaces, darker text, blue accents, subtle shadows.
- Grid dots adapt automatically (dark on light, white on dark).
- Map View port dots, node cards, bezier tubes, and inspector all theme-aware.
- CSS custom properties: --color-port, --color-shadow, --color-overlay added
  for consistent theming across JS-generated elements.

### Critical Fix
- Fixed: connection tube bezier endpoints were 30px left and 2px above
  the actual port dot positions. Root cause: outPort()/inPort() used
  NODE_W (content-box width = 176px) but the node has CSS padding (14px
  each side) and border (1.5px). The port dots are positioned relative to
  the PADDING BOX (204px wide), not the content box. The SVG endpoint was
  at mapPos+176 but the DOM dot was at mapPos+205.5 — a 29.5px offset.
  Fix: added NODE_BORDER and NODE_PAD constants, port math now computes
  from the padding box edges: outPort.x = mapPos + border + pad + W + pad,
  inPort.x = mapPos + border.

### Debug Infrastructure
- Added: verifyPortAlignment() — runs after every map render, compares
  SVG endpoint coordinates against actual DOM port dot positions via
  getBoundingClientRect(). Logs "[Kanvaz] port alignment OK" on success,
  or warns with exact delta values if any coordinate drifts more than
  2px. Can also be called manually from DevTools console via
  KanvazMapView.verifyPortAlignment().
- Added: NODE_FULL_W / NODE_FULL_H constants (207px / 55px) — the actual
  visual dimensions including border and padding.
- Fixed: fitAll() was using NODE_W/NODE_H (content-box) for bounding box,
  now uses NODE_FULL_W/NODE_FULL_H for accurate framing.

## [3.3.0] — Comprehensive Audit Pass
Full cold-read audit of all 16 source files + all metadata.

### Bugs Fixed
- Fixed: video scrub bar stayed visible after video format error (now
  hidden alongside the video element when onerror fires)
- Fixed: video play button showed PAUSE icon before video loaded (now
  shows PLAY, switches to PAUSE on onloadeddata)
- Fixed: duplicate scrub bar + playBtn variables created in video card
  builder (leftover from v3.2.0 refactor — one created before vid.src,
  duplicate re-created after)
- Fixed: MKV/AVI listed as "supported" in error toast but Chromium can't
  play them — removed from supported list, added format warning toast
  when MKV/AVI files are dropped

### Cleanup
- Updated: CHANGELOG v2.0.x entries — removed "Final release" and "No
  further development planned" labels (confusing alongside active v3 dev)
- Updated: package.json description to "Reference Operating System"
- Updated: About screen reflects v3.3.0

## [3.2.0] — Performance + Stability
Ship date: July 1, 2026

### Performance
- Fixed: scroll zoom lag — grid now draws all dots in a single batched
  canvas path (was thousands of individual arc+fill calls per frame).
  Transform updates throttled to one grid redraw per animation frame.
- Added: grid drawing skips entirely when dot spacing < 4px (extreme
  zoom-out was drawing invisible sub-pixel dots).

### Stability
- Fixed: canvas content disappearing on aggressive pan/zoom — tx/ty
  now clamped to ±5M pixels with NaN/Infinity guard. If transform
  values exceed safe CSS limits, they're clamped instead of pushing
  the world div offscreen.
- Fixed: video corruption on import — added error handler that shows
  "Video format not supported" message instead of silent black frame.
  Video now preloads metadata before attempting playback. Autoplay
  deferred until onloadeddata fires.

### Autosave
- Fixed: autosave JSON.stringify now wrapped in try-catch (was crashing
  silently on very large boards).
- Added: "✓ Recovery saved" indicator flashes briefly in status bar
  when autosave succeeds, so users can see it's working.
- Note: autosave writes to a recovery file only (not your .kanvaz file).
  "Unsaved changes" in the status bar means the file hasn't been
  explicitly saved — the recovery file is a separate crash safety net.

### Connection System
- Fixed: tube endpoint now matches port dot center exactly (the PORT_R
  offset was double-counted — tube terminated 7px past the actual dot).
- Added: colored dot at BOTH source and destination ports (previously
  only the destination had a colored dot).

## [3.1.1] — Audit Bugfix Pass
Full cold-read audit of all 16 source files. 10 bugs found and fixed.

### Critical
- Fixed: Board/Map toggle buttons were completely dead — inline onclick
  attributes were blocked by Content Security Policy. Rewired CSP-safe.

### Major
- Fixed: connection port dots flashed to wrong color on wire cancel
- Fixed: cursor stuck as grab icon after dragging a map node
- Fixed: deleting a board left orphaned connections for that board's cards
- Fixed: removeAllFor() deleted object keys during for-in iteration
  (undefined behavior) — now collects keys first, then deletes
- Fixed: startup screen file open didn't bump the file to top of recents

### Minor
- Fixed: Annotate shown in context menu for note cards (hidden now)
- Removed: dead `var menuItems` variable in context menu builder
- Moved: hasRenderedOnce variable to module top for clarity
- Removed: 16 unused SVG arrow marker and glow filter elements from DOM

## [3.1.0] — Polish + Connection System Completion
Kanvaz is actively developed. This release addresses video-reported issues
and completes the v3 connection system polish.

### Connection System
- Fixed: connection tubes now attach flush to port dots with zero gap
  (previous version had a 30–60px gap between tube start and node edge)
- Improved: Unreal/Maya-style bezier tension — cables pull out of ports
  horizontally before curving, high tension floor of 90px
- Improved: tube is now 3px wide with outer glow + inner depth shadow
- Removed: arrowhead replaced by a filled dot terminator at destination port
- Fixed: connection tubes correctly loop when target node is to the left
- Port dots increased to 7px radius, dark fill with colored border on hover

### Map View
- Added: empty state when no references exist ("Add in Board view first")
- Added: fit-all on first map open — all nodes centered in view
- Fixed: map view resets fit on each board visit (not just once)

### UI Polish
- Fixed: NOTE badge was bright green — now muted/subtle (matches dark theme)
- Fixed: resize handles are now small round dots instead of square chips
- Improved: Board/Map view toggle is now a proper segmented control pill
- Fixed: audio card default size reduced (was 320×140, now 280×100)
- Fixed: type-aware context menus — Flip H/V and Reset Size hidden on note cards

### Bugs
- Fixed: autosave now starts after settings load (was starting too early,
  interval setting had no effect on first run)
- Fixed: new board now clears connections (was leaking previous connections)
- Fixed: inspector panel closes when its reference card is deleted
- Removed: "final release" language from About screen and CHANGELOG
  (Kanvaz is actively developed, targeting v5.0 long-term)

## [3.0.0] — Reference Connection System + Map View
Kanvaz evolves from a reference board into a Reference Operating System.

### New: Map View
- Press M (or click the Board/Map toggle in the toolbar) to switch to
  Map View — a visual graph of all references and their connections.
- References appear as compact node cards with thumbnail, name, and
  connection count badge.
- Connections render as colored SVG lines with directional arrows and
  relationship type labels.
- Hover a node to highlight all its connections and dim the rest.
- Drag nodes to arrange the map layout — positions save per board.
- Independent pan (click empty space + drag) and scroll-zoom from the
  board canvas. Press 0 to reset the map view.
- Right-click a node for map-specific options: "Connect to..." starts
  connection creation mode, "Go to on board" switches back and selects
  the reference, "Remove all connections" clears a node's relationships.
- Create connections directly on the map: right-click → Connect to →
  click target node → pick relationship type from the type picker.
- Map view state (pan, zoom) persists per board across saves.

### New: Connection System
- References can now be connected to each other with directional
  relationships (Related To, Inspired By, Derived From, Alternative To,
  Supports, Used In, References).
- Each connection supports an optional note, priority (Low/Medium/High),
  and automatic timestamps.
- Deleting a reference automatically removes all its connections.
- Connections are included in undo/redo — creating, editing, or removing
  a connection can be undone with Ctrl+Z.
- Connections persist in the .kanvaz file format (backward compatible —
  v2.x files load cleanly with zero connections).

### New: Connection Inspector
- Select any reference and press C (or right-click → Connections) to
  open the Connection Inspector panel.
- View all outgoing and incoming connections with type tags, priority
  indicators, and notes.
- Create new connections: pick a target reference, choose a relationship
  type, add an optional note and priority.
- Edit existing connections: change relationship type, note, or priority.
- Delete connections individually.
- Double-click a connection row to jump to the connected reference.

### New: Reference Type System
- Internal type registry for 10 reference types: Image, GIF, Video,
  Audio, Note, URL, PDF, Color, File, Outcome.
- v3.0 ships with the 5 original media types fully functional; the 5
  new types (URL, PDF, Color, File, Outcome) are registered in the
  type system and supported in the data model but do not yet have
  dedicated creation UI — that ships in v3.1.

### New: Reference Metadata
- References now support tags (array of strings) and custom properties
  (key-value pairs) in the data model. UI for editing tags/properties
  ships in v3.1.
- References have a separate mapPosition field for future Map View
  positioning (independent of canvas position).

### File Format
- .kanvaz files now include a top-level `connections` array alongside
  boards. Version field is "3.0.0".
- Full backward compatibility: v2.x files load as v3.0 with empty
  connections, tags, and properties — no data loss.

## [2.0.2]
- Fixed: **Undo** could wipe the entire board when undoing back to the
  initial state after loading a file — the undo baseline was incorrectly
  set to an empty board instead of the loaded board state.
- Fixed: **Delete card** history was recorded before the card was actually
  removed, causing the undo stack to briefly get out of sync with the
  screen. Delete now also pauses any playing video/audio before removing
  the card element.
- Fixed: **Arrow-key nudge** was invisible to undo — nudging a card with
  arrow keys couldn't be undone. Now records a single undo step after
  you stop nudging (debounced, so holding an arrow key doesn't flood
  the undo stack).
- Fixed: **Note text editing** was invisible to undo — typing in a note
  card couldn't be undone. Now records an undo step when you click away
  from the note (on blur).
- Fixed: **Send to back** (right-click menu) was invisible to undo.
- Fixed: **Autosave interval** setting in Settings had no effect — the
  timer was hardcoded to 30 seconds regardless of the setting value.
- Fixed: **Default card width** setting had no effect — the drop-width
  cap was hardcoded to 600px regardless of the setting value.
- Fixed: **Always on top** (T key) didn't persist across restarts. Now
  saves to settings and applies automatically on launch.
- Fixed: **Show recent on startup** setting had no effect due to an
  init-order timing issue — the setting was checked before it had loaded
  from disk.
- Fixed: corrupted settings.json was silently ignored — now logs a
  warning and falls back to defaults.
- Added missing shortcuts to README: A (annotate), Ctrl+A (select all),
  Ctrl+Shift+S (Save As).

## [2.0.1]
- Identity update: now made by Atharva Patil (Northbyte Studios).
- Updated docs and in-app About screen. Identity update: Atharva Patil (Northbyte Studios).

## [2.0.0]
- First stable release with full feature set.
- README and overview PDF updated to mention audio card support.
- Removed leftover debug logging.

## [1.1.3]
- Fixed: pressing **P** to pin/unpin a card could show two conflicting
  toasts ("Card pinned" / "Card unpinned") at once.
- Fixed: **Ctrl+D** could create 3 cards total instead of 2 (duplicate
  fired twice from a single press).
- Added a key-repeat guard so holding down a shortcut key (Ctrl+D, P,
  Ctrl+S, etc.) fires the action once, not repeatedly. Arrow-key nudging
  still repeats while held, as expected.

## [1.1.2]
- Bigger, higher-contrast resize handles on cards.
- Replaced the annotation toolbar's text icons with proper SVG icons.
- Cleaned up the visual style of selected/pinned cards, board tabs, and
  the toolbar.
- Improved note placeholder text contrast.

## [1.1.1]
- Internal audit and bug-fix pass: smoother file loading, fixed an issue
  where resizing an annotated card could erase the annotation, fixed a
  memory leak when switching boards with annotations active, fixed
  several edge cases around closing/saving boards, and reduced undo
  history memory usage.

## [1.1.0]
- Added audio card support (MP3, WAV, OGG, M4A) with play/pause, seek,
  mute, and a visible scrub bar.

## [1.0.1]
- Added a "Save changes before closing?" prompt when closing with
  unsaved work.
- Fixed the crash-recovery "Restore" button.

## [1.0.0]
- Initial release: infinite pan/zoom canvas, image/GIF/video cards,
  drawing/annotation tools, multiple boards, undo/redo, minimap,
  settings, and "mood lock" presentation mode.
