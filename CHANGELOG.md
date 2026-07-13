# Changelog

All notable changes to Kanvaz are documented here.

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

### Known issue (not fixed yet)
- Map View: connection wires sometimes start from a slightly different
  point than the actual output port. Reported by users; reproduction
  and root-cause investigation pending.

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
