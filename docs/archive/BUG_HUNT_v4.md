# Kanvaz v4.0.0 — Full Bug Hunt & Future-Upgrade Audit

Full pass across every file in `src/`, `index.html`, `main.css`, CI config, and build config. Since v4.0.0 is the last planned major version (small fixes only from here), this is written to be exhaustive rather than quick. Read-only investigation — nothing here has been fixed yet.

Severity key: **CRITICAL** = silently loses/corrupts user data or breaks a core, advertised feature · **HIGH** = clearly broken behavior a user will hit · **MEDIUM** = real bug, narrower trigger or lower damage · **LOW** = nitpick/hardening/perf, no user-visible breakage today.

---

## CRITICAL

### 1. `serialise()` silently drops 4 shipped Phase 2 fields on every save
**`src/cards.js:1683-1719`**

The save-to-disk whitelist is missing `objectFit`, `playbackRate`, `audioLoop`, `colorFormat`:

```js
out.push({
  id: c.id, type: c.type, dataUrl: c.dataUrl, name: c.name, path: c.path,
  x: c.x, y: c.y, w: c.w, h: c.h, z: c.z, pinned: c.pinned,
  text: c.text || '', opacity: c.opacity !== undefined ? c.opacity : 1.0,
  flipH: c.flipH || false, flipV: c.flipV || false,
  naturalW: c.naturalW || c.w, naturalH: c.naturalH || c.h,
  annotations: strokes,
  tags: c.tags || [], properties: c.properties || {},
  mapPosition: c.mapPosition || null, url: c.url || null,
  color: c.color || null, mimeType: c.mimeType || null
});
```

Image cover/contain fit, video playback speed, audio loop toggle, and color-format display (hex/rgb/hsl) all work perfectly in the live session — they're stored on the in-memory card object and every render function reads that object directly — but none of them survive a save/reload, because `serialise()` is an explicit field-by-field whitelist, not a pass-through. These are all things the CHANGELOG/README advertise as v4.0.0 features. Anyone who sets a video to 2x speed, saves, and reopens gets 1x back with no error or indication anything was lost.

**Fix:** add the 4 fields to the whitelist object above. Two-line change, but check `deserialise()` (or wherever load reconstructs card objects) applies matching defaults for old files that predate these fields.

### 2. "Select All" (Ctrl+A) only visually selects — every follow-up shortcut acts on one card
**`src/cards.js:12, 1941-1949, 2016`**

```js
var selectedId = null;   // single id, not a set — line 12

function selectAll() {
  var ids = Object.keys(cards);
  if (!ids.length) return;
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.classList.add('selected');   // visually highlights ALL cards
  }
  selectedId = ids[ids.length - 1];          // but tracks only the LAST one
  KanvazUI.toast('All ' + ids.length + ' cards selected');
}

getSelected: function() { return selectedId; }   // line 2016 — returns the single id
```

`shortcuts.js` routes every card-shortcut (Delete, Ctrl+D duplicate, P pin, A annotate, H hide annotations, C connections, E properties, arrow-key nudge) through `KanvazCards.getSelected()`. After Ctrl+A, all cards *look* selected (CSS class added), but `getSelected()` returns only the last card's id. Press Delete after "Select All" expecting to clear the board — one card disappears, the rest silently stay. This is a correctness bug in a feature whose entire purpose is bulk action; a user has no reason to double-check that "Select All → Delete" didn't actually delete everything.

**Fix:** either make `selectedId` a set/array and update every consumer (`deleteCard`, `duplicateCard`, `togglePin`, etc.) to accept multiple ids, or — smaller change — make `selectAll()` a true no-op beyond visual highlight and clearly scope it to "for visual reference only" until real multi-select exists. Given this is the last major version, the pragmatic fix is probably: make Delete/Duplicate/Pin operate on `document.querySelectorAll('.card.selected')` instead of the single `selectedId`, since the DOM already has the right state.

### 3. Minimap click-to-pan is mathematically wrong at any zoom other than 100%
**`src/ui.js:42-52` vs. `src/ui.js:117-120`**

Click handler:
```js
wrap.addEventListener('mousedown', function(e) {
  var mx = (e.clientX - rect.left) / MMAP_W;
  var my = (e.clientY - rect.top)  / MMAP_H;
  var vp = KanvazCanvas.getViewport();
  var WORLD = computeWorld();
  var wx = mx * WORLD - vp.width  / 2;   // <- raw screen-pixel width
  var wy = my * WORLD - vp.height / 2;
  KanvazCanvas.panTo(-wx, -wy);
});
```

Compare to how the same module draws the viewport rectangle onto the minimap just below it:
```js
var vw = (vp.width  / vp.scale / WORLD) * MMAP_W;   // <- divides by scale here
```

`vp.width`/`vp.height` are screen-space pixels (confirmed by the drawing code dividing by `vp.scale` to convert to world units). The click handler never divides by `vp.scale`, so it treats screen pixels as world units directly. At 100% zoom this cancels out and looks correct; at any other zoom (app supports 8%–500%) the pan target is off by roughly `vp.width/2 * (1 - 1/scale)` — clicking the minimap at high zoom overshoots hugely, at low zoom undershoots. The feature basically only works by coincidence at exactly 1.0 scale.

**Fix:** `wx = mx * WORLD - (vp.width / vp.scale) / 2` and same for `wy`.

---

## HIGH

### 4. Escape doesn't cancel — it commits (board rename)
**`src/boards.js:216-237`**

```js
input.onblur = commit;
input.onkeydown = function(e) {
  if (e.key === 'Enter') { e.preventDefault(); commit(); }
  if (e.key === 'Escape') { renderTabs(); }
};
```

`renderTabs()` does `tabBar.innerHTML = ''` then rebuilds. Removing a focused `<input>` from the DOM fires a native `blur` on it first — which is wired to `commit()`. So pressing Escape while renaming a board tab doesn't cancel, it saves whatever text is currently typed, same as Enter. Confirmed via the DOM-removal-triggers-blur mechanism, not a hypothetical.

**Fix:** in the Escape branch, unhook `input.onblur = null` before calling `renderTabs()`.

### 5. Escape doesn't cancel — it commits (tag input), same root cause
**`src/cards.js:1416-1501`**

```js
if (e.key === 'Escape') { closeDropdown(); buildTagBar(cardEl, card); }   // line ~1495
...
input.addEventListener('blur', function() { addTag(); });                 // line 1497
```

Identical bug pattern to #4: `buildTagBar` tears down the DOM holding the focused tag input, firing `blur`, firing `addTag()` — so Escape while typing a tag adds whatever partial text was typed as a real tag instead of canceling. Checked every other `Escape` handler in the codebase for this same pattern (properties.js, map-view.js) — this and #4 are the only two live instances.

**Fix:** same as #4 — null out the blur handler before the DOM teardown in the Escape branch.

### 6. macOS: unsaved-changes prompt can be silently skipped after the first window closes
**`src/main.js:26`**

```js
var allowClose = false;   // module-level, never reset per window
```

macOS doesn't quit on `window-all-closed`, and `app.on('activate')` can spawn a new `BrowserWindow`. `allowClose` is a single module-level flag gating the "you have unsaved changes, really close?" dialog. If it was flipped to `true` to let the first window close, and a second window opens later in the same app session (very normal macOS flow — close last window, click dock icon to reopen), the flag is still `true` from before, so the new window's close button can skip the unsaved-changes check entirely on its first close. Data-loss risk, macOS-only, session-scoped (not per-window).

**Fix:** reset `allowClose = false` inside `createWindow()` for each new window instance, or move the flag onto the window object itself instead of module scope.

### 7. No `render-process-gone` handling in the main process
**`src/main.js`** (confirmed via full-file grep — zero matches for `render-process-gone`/`crashed`/`unresponsive`)

If the renderer actually crashes (not a caught JS exception — a real process crash), any main-process code that's `await`-ing an IPC round-trip response from that renderer (e.g. the close-request handshake at `main.js:146-213`) will wait forever with no timeout and no fallback. Low frequency (Electron renderer crashes are rare but not impossible — GPU driver issues, out-of-memory on a huge board), but when it happens the app can hang indefinitely instead of at least forcing a close or showing an error.

**Fix:** add a `webContents.on('render-process-gone', ...)` handler that force-resolves any pending close-handshake and optionally offers to reload/restart.

---

## MEDIUM

### 8. Video mute state isn't persisted
**`src/cards.js`** (`toggleVideoMute()` / video card render path)

`vid.muted` is toggled at runtime but never written onto the `card` object, so it reverts to muted-by-default on every reload — same class of bug as finding #1 but for a field that was never in the whitelist to begin with (not a regression, just an always-missing field). Bundle with the #1 fix.

### 9. `capSize()` only caps width, not height
**`src/media.js:73-82`**

```js
function capSize(w, h) {
  var maxW = MAX_DROP_WIDTH; // 600 default
  ...
  if (w <= maxW) return { w: w, h: h };
  var ratio = maxW / w;
  return { w: maxW, h: Math.round(h * ratio) };
}
```

A tall portrait image (e.g. 300×3000) has `w <= maxW` and passes through completely unscaled, producing a card 10x taller than wide dropped straight onto the canvas. Reasonable for the VFX/3D reference-board use case to hit occasionally (tall concept sheets, film strips).

**Fix:** cap by whichever dimension overflows more, same pattern extended to height.

### 10. `getTypeFromDataUrl()` has no audio branch — clipboard-paste audio is dead code
**`src/media.js:31-36` vs. `src/media.js:5-8`**

`getType()` (extension-based, used for file drops) supports audio via `AUDIO_EXTS`. `getTypeFromDataUrl()` (mimetype-based, used for clipboard paste) checks `image/gif`, `video/`, `image/` — no `audio/` branch, so it always returns `null` for audio data and `loadFromDataUrl`'s `type === 'audio'` branch (media.js:157) can never actually be reached. Low real-world frequency (few OS clipboards carry raw audio the way they carry images), but it's a genuine asymmetry between the two type-detection paths that's worth closing while touching this file for #9.

### 11. `deleteBoard()` cascade-delete reads a possibly-stale card snapshot for the active board
**`src/boards.js:241-289`**

When deleting the currently active board, the connection-cascade-delete step reads `boards[idx].cards`, which is the last snapshot written by `saveCurrentBoardState()` — not the live in-memory card list. If cards were added/moved since the last state save and the board is deleted before that save runs, connections referencing the newest cards can survive as orphans instead of being cascade-removed.

### 12. Shortcuts overlay lists "Cards" twice with duplicate entries
**`src/ui.js:789-852`**

The `groups` array has two separate entries both named `'Cards'` (lines ~804 and ~840). `Delete`, `Ctrl+D`, `P`, and `H` appear verbatim in both, so the `?` shortcuts overlay shows the same four shortcuts twice across two different columns, both titled "Cards" — clearly a copy-paste artifact from when Annotate/Connections/Properties shortcuts were added as a new group instead of merged into the existing one.

**Fix:** merge the two `'Cards'` groups into one (Click, Drag, Delete, Ctrl+D, P, A, C, E, H, Arrow keys, Shift+Arrow, Ctrl+A) — also fixes the 3-column CSS grid layout, which currently leaves group 5 dangling alone on a second row.

### 13. Properties panel can't be closed with Escape or E once focus is inside it
**`src/properties.js:97`**

```js
panelEl.addEventListener('keydown', function(e) { e.stopPropagation(); });
```

This stops every keydown inside the panel from reaching the document-level shortcut dispatcher in `shortcuts.js` — including Escape (global "close panels") and E (the panel's own documented toggle-close key, per its own close button's tooltip: `title: 'Close (E)'`). Once the user has clicked into any input inside the panel, the only way to close it is the ✕ button; both of the panel's own advertised close shortcuts stop working. The Inspector panel (`inspector.js`) has no equivalent blanket `stopPropagation` and doesn't have this problem.

**Fix:** narrow the `stopPropagation` to only the specific keys that need protecting from global shortcuts (e.g. don't let Delete-key-while-typing-in-a-value-field delete the card), and let Escape through explicitly to close the panel.

### 14. Annotation canvases aren't DPI-aware — blurry on HiDPI/Retina
**`src/annotate.js`** (canvas creation + `resize()`)

Canvas `width`/`height` are set directly from `cardEl.offsetWidth`/`offsetHeight` (CSS pixels), never multiplied by `window.devicePixelRatio`. On any HiDPI display the canvas backing store renders at a lower resolution than the screen and gets upscaled by CSS to fill the card, so pen/arrow/rectangle annotations look visibly soft compared to the sharp image underneath. Worth prioritizing given the target audience (VFX/3D artists) skews toward high-res displays. Note `getPos()` itself is fine — the position math is ratio-based so drawing *accuracy* isn't affected, only sharpness.

**Fix:** standard pattern — `cvs.width = cardEl.offsetWidth * dpr`, `cvs.height = cardEl.offsetHeight * dpr`, keep CSS size at the un-multiplied value, then `ctx.scale(dpr, dpr)` once after context creation.

---

## LOW / polish / hardening

- **`main.js:125-131`** — `sandbox: false` in `webPreferences`. `contextIsolation: true` + `nodeIntegration: false` are already correctly set, so the exploitable surface is small, but flipping `sandbox: true` would be the stronger default if nothing in preload.js needs a non-sandboxed API (worth a quick check before flipping — not verified either way here).
- **`main.js`** — IPC handlers (`file-read`/`file-write`/`media-load`/`dialog-open-media`) trust renderer-supplied paths with only `media-load` doing an extension check; no main-process allowlist boundary. Reasonable for a fully offline, single-user local app (the renderer isn't attacker-controlled in that threat model) — flagging so it's a documented, deliberate choice rather than an oversight.
- **`main.js`** — `reset-app-data`'s cleanup loop uses `fs.unlinkSync` in a directory walk with no subdirectory guard; fine as long as `RECOVERY_DIR` never contains subfolders, worth a defensive check since it's a destructive operation.
- **`main.js`** — `dialog.showOpenDialogSync`/`showSaveDialogSync` block the whole main process while open. Standard Electron pattern, only matters if the main process needs to stay responsive to something else during that dialog (it doesn't currently).
- **`main.js`** — `media-load` validates by extension only, no magic-byte sniffing. A renamed file would fail later at decode time with a generic error rather than a clean "not really an image" message.
- **`preload.js`** — `off(channel)` has no allowlist check (unlike `on()`) and removes *all* listeners for that channel rather than one specific callback. Not currently exploited anywhere, just a footgun for future preload additions.
- **`app.js`** — context-menu items built via `el.innerHTML = item.label + ...`. Currently safe (every `.label` is a static string or type-constrained ternary, verified across all call sites), but fragile — a future menu item built from a card name or tag would reintroduce an XSS path. Worth switching to `textContent`/DOM construction preemptively.
- **`app.js`** — `markDirty()`/`markClean()`/`setCurrentPath()` don't early-return when state is unchanged. Confirmed none of the ~30 call sites are in a per-frame hot loop today, so this is a "cheap to add, no urgency" micro-optimization.
- **`app.js`** — `placePurImages()`: if a single image's `getNaturalSize()` callback never fires (corrupt PNG chunk from a `.pur` import), the whole batch's completion toast/markDirty/zoomFit silently never happens, even though the other images did get placed. No error surfaces.
- **`app.js`** — search bar has no debounce on `input`. Not a bug at current expected board sizes, worth revisiting if boards regularly exceed a few hundred cards.
- **`map-view.js`** — `renderLines()` does a full clear+rebuild of every connection's SVG (6 elements each) on *every* mousemove during a node drag, regardless of whether that connection touches the dragged node. Real, avoidable cost on boards with many connections; should update only the affected connections' `d`/`cx`/`cy` attributes incrementally.
- **`map-view.js`** — Delete key removes connections for the selected node, not the card itself — different semantics from Board View's Delete. Looks intentional but worth a one-line mention in the shortcuts overlay to avoid surprising users switching views.
- **`annotate.js`** — `onDown()` calls `activeCtx.getImageData()` on the full canvas unconditionally, including for the 'pen' tool, which never uses the resulting snapshot (only 'rect'/'arrow' do, for live-preview redraw). Gate it behind `if (activeTool !== 'pen')`.
- **`annotate.js`** — toolbar reposition only reacts to canvas pan/zoom (`MutationObserver` on `#canvas-world`'s `style` attribute), not window resize. Toolbar can drift out of alignment with its card if the window is resized while annotating.
- **`shortcuts.js`** — `inText` guard (`tag === 'TEXTAREA' || tag === 'INPUT'`) doesn't check input `type`. Clicking a checkbox/range control in Settings and then pressing a single-letter shortcut (T, L, 0, etc.) does nothing, because `inText` is true even though nothing text-editable has focus.
- **`connections.js`** — `getAll(refId)` requires an argument and returns a filtered subset, unlike `KanvazCards.getAll()` (no argument, returns everything). Same method name, different contract — a `KanvazConnections.getAll()` call with no argument silently returns `[]` instead of erroring. Naming footgun for future code, not a live bug today.
- **`pur-import.js:38-44`** — `readBigUInt64BE` computes `hi * 0x100000000 + lo` using floating-point multiplication, which loses precision past 2^53. Real `.pur` files are always well under that range (byte offsets in a file that's at most a few hundred MB), so not practically triggerable — noted for correctness completeness only.
- **`ui.js`** — `compareVersions()` does `Number()` on dot-separated segments; a pre-release tag like `4.0.1-beta.1` would produce `NaN` mid-comparison and the update-available check would silently report "up to date." Not currently exploitable (no pre-release tags are cut), worth a guard if that ever changes.
- **`index.html`** — CSP is solid (`script-src 'self'`, no `unsafe-eval`, `connect-src` scoped to exactly the one GitHub endpoint used) but doesn't set `object-src 'none'` or `base-uri 'self'`, both cheap, standard defense-in-depth additions.
- **`reference-types.js`** — `url`, `pdf`, `file`, `outcome` types are fully registered (icon, label, fields) but have no creation UI anywhere in the app (confirmed — no drag-drop handler or context-menu entry creates them). This matches the README's own "known limitations," so it's not a surprise, but worth an explicit decision now: since v4.0.0 is the last major version, either ship minimal creation UI for these before the freeze, or remove them from the type registry so a future maintainer doesn't wonder why four types exist with no way to create them.

---

## Future-upgrade / architecture notes

Not bugs — things that would meaningfully help if there's ever a v4.x beyond small fixes, or just worth knowing about for anyone else who touches this code later.

**No unit/integration tests.** `test/*.js` covers lint (var-only ES5 rule), syntax check, and version-consistency — none of it exercises actual runtime behavior (serialization round-trips, undo/redo, connection cascade-delete, etc.). Several of the bugs above (especially #1 and #2) are exactly the class of regression a handful of targeted unit tests would catch immediately and would have caught before this release shipped. Even 10-15 tests around `KanvazCards.serialise()`/`deserialise()` round-tripping every field, and `selectAll()` + each shortcut, would have high leverage for whatever "small bug fixes" come next.

**Global-namespace IIFE modules with manually-ordered `<script>` tags.** Every module attaches to `window` (`KanvazCards`, `KanvazUI`, etc.) and `index.html` loads them in a hand-maintained dependency order. Works fine today because the ordering is already correct, but it's silently fragile — reordering two script tags, or adding a new module that references another one before it's loaded, fails at runtime with an `undefined is not a function` rather than a build-time error. A bundler + ES modules would remove this whole class of risk, at the cost of adding a build step to what's currently a zero-build, `electron .`-and-go dev workflow. Given the "last major version" framing, probably not worth it unless there's appetite for it — but worth knowing this is *why* load order matters so much in `index.html`.

**`main.css` (1808 lines) has no dead-CSS verification.** No tooling (PurgeCSS or similar) cross-references class usage between the CSS and the JS/HTML that generates class names dynamically. A manual audit isn't really tractable at this size/dynamism; if trimming is ever wanted, an automated pass would find real answers where a manual read would just guess.

**`boards.js`'s `showStartupScreen()` recent-file click handler duplicates ~25 lines** that already exist in `openFilePath()`. Not a bug (both paths do the same correct thing), just a maintenance smell — a future fix to one won't automatically apply to the other. Worth collapsing to a single call to `openFilePath(p)`.

**IPC file-path trust model is implicit, not documented.** `file-read`/`file-write`/`media-load` trust renderer-supplied paths with no allowlist. This is a fine choice for a fully offline, single-user desktop app (the renderer is never attacker-controlled input from a network), but nowhere in the codebase is that reasoning written down. A short comment block in `main.js` stating the accepted threat model would save a future reviewer (or future-you) from re-litigating whether this is a security bug.

---

## Suggested fix order for the "code improvement session"

1. **#1** (serialise whitelist) — highest damage, smallest fix, directly undoes advertised v4.0.0 features.
2. **#2** (Select All) — silent data loss on a core bulk-action shortcut.
3. **#4 / #5** (Escape-commits bugs) — same one-line fix pattern in two places.
4. **#3** (minimap pan math) — one-line formula fix.
5. **#6 / #7** (main.js macOS flag + crash handling) — lower frequency but real data-loss/hang risk.
6. Everything in **MEDIUM**, roughly in the order listed — all small, contained fixes.
7. **LOW** items opportunistically, whenever touching the relevant file for something else.
8. Future-upgrade notes are food for thought, not action items — flagged here so the reasoning exists in writing before the freeze.
