# Kanvaz 4.2.1 — Full-Stack Audit & Hardening Report

**Scope of this session:** finish the plugin system foundation, ship a first
real official plugin (Theme Creator), audit the entire codebase twice with
independent methodologies, fix what both audits found, harden for
cross-platform builds, and leave the repo in a ship-ready state at v4.2.1.
Performed autonomously start to finish — this doc is the handoff summary.

---

## 1. What shipped

### Plugin system, Layer 1
- `src/plugin-loader.js` (main process) — manifest scan/validate/state,
  path-containment checks on every plugin-related filesystem operation.
- `src/plugin-api.js` (renderer) — `window.KanvazPluginAPI`:
  `registerCardType`, `registerTheme` + `applyTheme` (full-peer theme
  model), `registerSettingsPanel`, size-capped `storage.load`/`storage.save`.
- Native-dialog-mediated install consent (`dialog.showMessageBox`) — the one
  trust gate a co-resident plugin script genuinely cannot forge or auto-click.
- Settings → Plugins UI: list, enable/disable, remove, "Add a Plugin…".
- Graceful degradation: a missing/broken plugin never breaks the rest of a
  board — just that one card, with a clear placeholder.

### Theme Creator (first official plugin)
`official-plugins/theme-creator/` — a full in-app theme editor: live color
pickers with instant app-wide preview, save-as-preset, a presets list with
pin/star/rename/apply/edit/delete, one-click reset to Kanvaz's own defaults.
Ships as a separate install (same Add-a-Plugin flow as any third-party
plugin), never bundled into the base installer — keeps "100% offline by
default" true in the strongest sense.

### Honest trust-model documentation
The plugin sandbox is **convention-based, not process-isolated** — same
trust model as a VS Code/browser extension, a deliberate v1 choice, not an
oversight. `SECURITY.md` now has a dedicated "Plugin System — trust model"
section stating plainly that an approved plugin has the same practical
access as Kanvaz's own code, and that the declared permission list is not
currently enforced at the IPC layer. This was previously implied to be more
restrictive than it actually is — the underlying behavior didn't change,
only the documentation now matches it.

---

## 2. Audit methodology (two independent passes)

**Pass 1 — code logic & security.** 6 parallel subagents, each given a
cluster of files with no visibility into the others' findings, adversarial
brief, severity-rated output, ship/no-ship verdict per cluster:
1. `main.js` / `preload.js` / `plugin-loader.js` / `plugin-api.js`
2. `app.js` / `boards.js`
3. `cards.js` / `canvas.js` / `map-view.js`
4. `ui.js` / `annotate.js` / `shortcuts.js` / `media.js`
5. `inspector.js` / `connections.js` / `properties.js` / `history.js` /
   `errors.js` / `reference-types.js` / `pur-import.js` / `board-container.js`
6. `main.css` / `index.html` / test infra / build config

**Pass 2 — brutal UI copy & information accuracy.** A separate subagent,
explicitly briefed that no running GUI was available in this sandbox, told
to work by static read-through and cross-reference every user-facing claim
(tooltips, overlays, first-run screen, README/CHANGELOG/SECURITY.md)
against what the code actually does. This is the pass that catches "the
text says X but the setting defaults to off" bugs that a pure logic audit
won't — worth doing as a distinct step, not folded into pass 1.

Every finding across both passes was triaged and either fixed (see below)
or explicitly deferred with a documented reason (Section 4).

---

## 3. Fixes applied (by category)

### Data loss — the highest-priority class of bug found
- Annotations (pen/arrow/rectangle) weren't marked dirty or pushed to undo
  history — closing right after annotating, with no other change to
  trigger a save prompt, silently lost the annotation. Fixed.
- `pluginData` wasn't deep-cloned in undo/redo snapshots — captured by
  reference, so a later in-place mutation could retroactively corrupt an
  already-pushed history entry. Now cloned with a safe fallback.
- A single non-serializable card could abort saving or asset-packing for
  the *entire* board. Save, Save As, autosave, and the board-container
  packer now isolate a bad card to itself instead of losing everything.
- `deserialise()` let one malformed card crash loading the whole board —
  each card now loads inside its own try/catch.
- Windows path-separator bug: "Board saved as …" toast showed the full
  absolute path instead of the filename on Windows (forward-slash-only
  split against a backslash path).

### Security
- Plugin storage writes could race (overlapping saves for the same plugin
  shared one temp filename) — fixed with a unique temp file per write,
  size-capped at 5MB.
- A plugin could register theme id `"dark"` or `"light"` and silently
  hijack a built-in theme app-wide — now rejected.
- `plugins-remove` could wipe the wrong plugin's data on a mismatched
  folder/id pair — now requires a verified match.
- Recent-boards list was built with string-concatenated `innerHTML` — a
  board/folder name with HTML-like characters could inject markup.
  Rebuilt with safe DOM text nodes.
- Added `will-navigate` / `setWindowOpenHandler` guards in the main
  process (closes an exfiltration/redirect path a compromised renderer
  script could otherwise attempt) and `worker-src 'self'` to the CSP.
- The IPC comment blocks, the install-consent dialog copy, and
  `SECURITY.md` were rewritten to honestly disclose the permission-model
  gap described in Section 1, rather than implying stronger enforcement
  than actually exists.

### Plugin robustness
- A plugin card type, context-menu builder, or Settings panel throwing
  during render is now isolated with a visible fallback instead of taking
  down more than itself.
- Plugin Settings panels were being rendered *before* being attached to
  the page, breaking any `getComputedStyle`/`getBoundingClientRect` call
  inside a plugin's `render()` — rendering is now deferred until the
  container is actually in the DOM.
- Removed the dead `pdf` ghost entry from the card-type registry (no
  creation path ever existed for it).

### Shortcuts & input
- **Every Ctrl-combo shortcut broke under Caps Lock** — comparisons
  against `e.key`'s hardcoded case silently failed when Caps Lock flipped
  the reported case. Now compares a lowercased key against the modifier
  booleans only.
- Properties/Inspector panels swallowed Ctrl+S/Ctrl+Z etc. while open —
  modifier-held shortcuts now bubble through; plain keys still don't leak
  into card-level handlers.
- Toggling theme via the `L` shortcut no longer bypasses the cleanup that
  removes a stale plugin-theme stylesheet.

### Smaller correctness fixes
- `getNaturalSize`/`getVideoSize` could hang indefinitely on a malformed
  media file — now time out after 8s with a sane fallback size.
- Map View's `setState()` and port-position math no longer accept
  negative/NaN/out-of-range values; the sanity bound was widened to stop
  clipping ports on very large auto-laid-out boards (2,700+ cards).
- `formatTime()` no longer prints garbage for a non-finite duration.
- Two dead/duplicate CSS rules and hardcoded light-theme color literals
  replaced with the shared accent-color variable.

### UI copy & documentation accuracy (Pass 2 findings, all fixed)
- Shortcuts overlay, canvas right-click menu, and the first-run welcome
  screen all described double-click-to-create-a-note as if it always
  works — it's **off by default**. All three now reflect the actual
  setting, or hide the hint when it doesn't apply.
- Added the missing `Ctrl+F` / `/` search shortcut and the
  `Ctrl+Shift+F` Top Mode alternate binding to the Shortcuts overlay.
- Titlebar's "Export board" button actually performs a Save As to the
  same `.kanvaz` format, not a format conversion — relabeled "Save board
  as…".
- README/SECURITY.md claimed the update check was "a single request" —
  it's actually two independent requests per click (the bundled
  updater's own check, plus a separate version-info lookup). Corrected.
- SECURITY.md still described `.kanvaz` as "plain JSON with base64
  media" — stale since the 4.1.0 zip-container change. Corrected.
- README called the (now-removed) `pdf` type "still in the registry" and
  called Theme Creator "planned" despite it shipping. Corrected.
- CHANGELOG's 4.2.0 entry said "no first-party plugins ship yet,"
  directly contradicting Theme Creator shipping in that same release —
  rewritten to actually list everything 4.2.0 shipped.

### Cross-platform hardening
- Windows/macOS/Linux CI build+publish pipeline (`.github/workflows/build.yml`)
  was already solid going in — confirmed, not rebuilt.
- Fixed the one real cross-platform bug found: the Windows path-separator
  issue above.
- Added a Chrome-install step to CI so the port-alignment regression test
  (`test/run-port-test.js`) actually runs on `ubuntu-latest` instead of
  silently SKIPping every single run. **This CI change is unverified** —
  GitHub Actions can't be executed from this sandbox. Worth confirming on
  the next push.

---

## 4. Deliberately not fixed (with reasoning)

- **Per-plugin process isolation.** The convention-based sandbox model
  (Section 1) is the user's earlier explicit choice, not a bug to
  re-architect around tonight. Disclosed honestly instead. Real
  per-plugin isolation is tracked as future work in `SECURITY.md` and
  `docs/PLUGIN_SYSTEM_DRAFT.md`.
- Two lower-priority `canvas.js` findings (viewport clamp at extreme pan
  distances, additive zoom-step inconsistency) — noted, not fixed.
- No conflict/staleness check on save (mtime comparison against the file
  on disk) — speculative, lower priority, deferred.
- Packaging automation for official-plugin release assets (zipping
  `official-plugins/theme-creator/` for a GitHub release) — no CI step
  exists yet for this. Recommended next step, not built tonight.

---

## 5. Validation

`npm run validate` (syntax, lint, board-container round-trip, plugin-loader
tests, version consistency) passes clean at every checkpoint through this
session, most recently after the 4.2.1 version bump:

```
✓ all 21 files parse
✓ no lint issues
SKIP — port alignment (no Chrome binary in this sandbox — expected; the CI fix above targets this)
✓ board container format round trip
✓ plugin loader tests
✓ version consistency (boards.js / ui.js / README all read 4.2.1)

ALL CHECKS PASSED — ship it.
```

`test/format-roundtrip-test.js` also passes clean (old-format detection,
zip-container production, byte-for-byte media round-trip, non-media
pass-through, corrupted-asset graceful degradation).

**Not verified in this sandbox** (no GUI, no real Chrome, no CI runner
available here) — recommend a manual smoke test before the next release:
- Theme Creator's actual UI (color pickers, live preview, presets) —
  logic and syntax verified, never rendered.
- The first-run welcome screen and Shortcuts overlay's new conditional
  text, visually.
- The CI Chrome-install step (`.github/workflows/build.yml`) on an actual
  push.
- A real Windows/macOS/Linux build via `npm run build:win` /
  `build:mac` / `build:linux`.

---

## 6. What changed (files)

29 files touched: `package.json`, `package-lock.json`, `CHANGELOG.md`,
`README.md`, `SECURITY.md`, `docs/PLUGIN_SYSTEM_DRAFT.md`,
`docs/generate_overview_pdf.py`, `.github/workflows/build.yml`, and 21
files under `src/` (`main.js`, `preload.js`, `plugin-loader.js`,
`plugin-api.js`, `app.js`, `boards.js`, `cards.js`, `annotate.js`,
`history.js`, `shortcuts.js`, `properties.js`, `inspector.js`, `errors.js`,
`map-view.js`, `media.js`, `main.css`, `index.html`, `board-container.js`,
`reference-types.js`, `ui.js`). Plus one new directory:
`official-plugins/theme-creator/` (untracked, needs `git add`).

---

## 7. Version

Bumped **4.2.0 → 4.2.1** across all 6 canonical locations
(`package.json`, `package-lock.json` ×2, `src/boards.js` `VERSION`,
`src/ui.js` About screen ×2, `README.md` build-output example) plus the
docs PDF generator's version pill. `npm run validate`'s version-consistency
check confirms all three of its tracked locations agree.

---

## 8. Next steps for you

1. Skim the diff — `git diff --stat` gives the shape, the CHANGELOG 4.2.1
   entry above gives the plain-English version.
2. Do the manual smoke test listed in Section 5 (Theme Creator UI
   especially — that's the one substantial piece of new UI I couldn't
   render in this sandbox).
3. Commit, tag, and push whenever you're ready — command below.
4. After pushing a `v4.2.1` tag, watch the Actions run once to confirm the
   new Chrome-install step actually fixes the port-test SKIP.

**Git Bash only** — single command, run yourself when ready:

```bash
cd /f/OBL/Kanvaz && git add -A && git commit -m "v4.2.1 — full-stack audit and hardening pass" && git tag v4.2.1 && git push origin main --tags
```
