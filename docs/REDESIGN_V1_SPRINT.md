# Kanvaz Redesign v1 — Sprint Plan

**Merged into `main` as v7.8.0; Phase 3 shipped as v7.9.0; per-profile
plugin state landed after that (see the note under Phase 2 below).**
Tracked on the `redesign-v1` branch while in progress (kept, not
deleted, as the historical record of this sprint). No Figma file ended
up coming — the user's own reference screenshot (shared directly in
chat) was used as the literal design spec for Phase 3 instead. Two
deferred parts of Phase 2 remain open — Export/Import profile as a
portable file, and a Start Screen profile picker — track those as their
own follow-up work, not part of this document's remaining scope.

Full detail for each phase lives in its own plan doc — this is the
sequencing and the definition of done.

## Phase 1 — Side panel — **DONE, merged to `main` in v7.8.0**

Plan: `docs/SIDE_PANEL_PLAN.md` (fully resolved, no open questions).

Implemented in new `src/sidepanel.js` (orchestrator) plus changes to
`boards.js` (`renderTabs` → `renderBoardsList`, targets a container
instead of the removed `#board-tabs`), `properties.js` (`open`/`close`/
new `renderInto` delegate to `KanvazSidePanel` instead of building a
floating panel), `ui.js` (`showSettings`/`closeSettings` replaced with
`renderSettingsInto`/`closeSettingsSection`, reorganized into General /
Canvas & Input / Files & Search / Plugins / Advanced-collapsible),
`index.html`/`main.css` (new DOM + styles), and call-site updates in
`app.js`/`commands.js`/`shortcuts.js`. One real bug caught in self-
review before commit: `properties.js`'s per-section keydown listener
was attached to the persistent panel container on every render with no
guard, stacking indefinitely across section switches — fixed with a
one-time-attachment marker, verified live that 10 rapid section
switches still leave exactly one listener bound.

- Left-docked panel, icon rail always visible, content pane toggles
  with `S`.
- Sections: Boards (replaces the tab strip entirely), Properties (moved
  in from its current separate slide-out), Settings (reorganized per
  `docs/SETTINGS_UX_PLAN.md`'s 4-category structure).
- Corner icon (top-right) replaces the `Settings | About | ?` cluster —
  opens Profile/About/Shortcuts menu (Profile section is a stub until
  Phase 2 lands; About + Shortcuts are real from day one).
- Old Settings popover + titlebar Settings button removed the moment
  this ships (no transition period, per decision).

**Definition of done:** tab strip is gone, Settings/Properties both live
in the new panel, `S` toggles it, old popover code deleted (not just
unreachable), live-verified via CDP that switching boards/opening
Settings/opening Properties all work through the new panel with zero
console errors.

## Phase 2 — Start Screen + Profiles system — **DONE (both parts), merged to `main` in v7.8.0**

Plan: `docs/PROFILES_SYSTEM_PLAN.md` (fully resolved, no open questions).

Turns out Kanvaz already had a "Start Screen" of sorts — `boards.js`'s
`showStartupScreen()` (recent boards + New board, gated on the
`openOnStartup` setting) — it just didn't know to stay out of the way on
a direct file-open launch, so a double-click on a `.kanvaz` file could
show it flashing underneath the board that's about to load. Fixed by
having `main.js` compute `hasStartupFile` before `createWindow()` and
pass it in via `webPreferences.additionalArguments`, read synchronously
in `preload.js` (`KanvazBridge.hasStartupFile()`) and checked at the top
of `showStartupScreen()` before any settings/recent IPC round-trip — no
flash, no wasted IPC. `boards.js`'s `openFilePath()` also now calls
`closeStartup()` defensively on every call site (covers the
second-instance handoff: double-clicking another file while Kanvaz is
already open and showing the Start Screen). Live-verified via CDP both
ways: a plain launch with a seeded `recent.json` shows the screen with
`hasStartupFile:false`; launching with a file argument shows
`hasStartupFile:true` and the screen never renders, board opens
directly.

**Update — the Profiles system landed too, as its own slice.** New
`src/profiles.js` (main process) owns the storage/migration engine:
`userData/profiles/<id>/` per profile, a `manifest.json` + an
`active-profile.json` pointer, idempotent `ensureMigrated()` that moves
an existing install's root-level `settings.json`/`recent.json`/`recovery/`
into a newly-created default profile (named from the OS username) the
first time it ever runs, and self-healing if the active pointer or
manifest ever gets out of sync. `main.js`'s settings/recent/recovery IPC
handlers all now resolve their path through
`kanvazProfiles.getActiveProfileDir()` instead of `userData` directly —
functions, not cached constants, so a profile switch takes effect
immediately with no extra plumbing. New `profiles-*` IPC (list/create/
switch/rename/update/set-avatar/delete), exposed via preload.js.
Switching profiles relaunches the whole app (same "ending this user
session" decision as the plan) via the existing `app-relaunch` IPC,
after the same Save/Don't-Save/Cancel gate `openFilePath()` already uses
for unsaved changes (`KanvazBoards.confirmDiscardIfDirty`, now exported).

UI: the corner account menu's "Manage Profiles…" opens a dialog listing
every profile with an avatar circle (initial-letter fallback), name,
optional description, Switch/Edit/Delete per row (Delete guarded:
can't delete the active profile or the only remaining one), a "+ New
Profile" row, and a "+ Add Guest Profile" quick-create (a profile named
"Guest" with a `guest:true` badge — persists like any other profile,
NOT an ephemeral/auto-wipe sandbox; see the scope note in profiles.js).
Edit expands inline into name + description fields and a "Change
Photo…" button (picks an image, downscales it to a 96px square in the
renderer via canvas, stores it as a small inline `avatarDataUrl` in
manifest.json — avoids new file-serving IPC or loosening the img-src
CSP for what's already a client-side, non-networked feature).

Live-verified via CDP with isolated `--user-data-dir` profiles:
migration of real legacy settings/recent/recovery content byte-for-byte
into a new profile; a fresh install with zero legacy data auto-creating
one default profile; create/switch/edit/guest-create/delete-guard all
round-tripping correctly; a switch's relaunch landing on the new
profile's own isolated (empty) recent-boards list while the original
profile's data stayed untouched on disk.

Deliberately deferred (see profiles.js's own scope-note comment,
not oversights): the dedicated first-run "Set up your profile" wizard
screen from the plan (a fresh install auto-names from the OS username
instead, renameable any time); Export/Import profile as a portable
file; and the multi-profile Start Screen picker (today's Start Screen
doesn't yet surface a profile switcher itself — only the account-menu
dialog does).

**Update — per-profile plugin state landed after all, as its own
follow-up slice.** plugin-loader.js's state-touching functions
(`scanPlugins`, `approvePlugin`, `setEnabled`, `removePlugin`,
`readPluginStorage`/`writePluginStorage`) now take a separate
`statePath` parameter — the ACTIVE PROFILE's own directory — alongside
`userDataPath`, which stays the shared `userData/plugins/` folder for
plugin CODE only (installing a plugin is still a machine-level action,
per this plan's "what a profile owns" section). Which plugins are
enabled/approved, and each plugin's own saved storage (e.g. Theme
Creator's presets), are now genuinely per-profile — Profile A approving
and enabling a plugin has zero effect on whether Profile B sees it as
approved. `test/plugin-loader-test.js` updated for the new
two-parameter signature (a single test tmpdir passed as both
arguments, since the test has no profile system in play). Verified with
a standalone script exercising two real profile directories sharing one
plugin-code folder: Profile A shows the plugin enabled and consent-free
after approving it there; Profile B, never having approved it, still
correctly shows `needsConsent: true`.

Also, per direct feedback mid-sprint: Settings' categories were
adjusted — a dedicated "Appearance" section split out from "General"
(theme, minimap, grid, card shadows, animations), and the collapsible
Advanced section split into Diagnostics / Plugin Dev / Reset
sub-headers instead of one flat list of unrelated dev tools.

- Start Screen on plain launch (recent boards, New board, branding),
  skipped when opening a `.kanvaz` file directly.
- Full profile data model: `profiles/<id>/` owning settings, recents,
  recovery, per-plugin storage, Smart Search index. Migration path for
  existing single-profile users (auto-created default profile).
- Profile switcher lives in the Phase 1 corner icon (now made real) and
  on the Start Screen for multi-profile installs.
- Export/Import profile as a portable file (the offline "sync"
  equivalent).

**Definition of done:** a fresh install walks through profile setup on
first launch; an existing install auto-migrates without losing settings;
switching profiles round-trips correctly including the unsaved-changes
save gate; Export → Import on a second local profile folder produces an
identical profile. Live-verified via CDP, not just unit-level.

## Phase 3 — Card visual polish — **DONE, shipped as v7.9.0**

No Figma file arrived — implemented directly against the user's own
reference screenshot as the literal spec instead. Always-visible name +
metadata footer (resolution/duration/char-count) with one consistent
type pill per card, replacing the old hover-only row of small per-type-
colored badges; a new `--radius-card` token for a bigger corner radius
independent of the rest of the app's `--radius-md`; a real hover-lift
elevation. Full detail in CHANGELOG.md's 7.9.0 entry.

Explicitly NOT covered by this phase (raised as separate feedback,
tracked as its own follow-up rather than folded in here): file-
reference cards showing the actual image/PDF preview inline instead of
a generic file icon, and the annotation toolbar not scaling with a
resized card.

**Definition of done:** whatever your Figma spec defines, implemented
and matched — this phase's "done" is defined by your design handoff,
not by this document.

## Phase 4 — Final full audit suite (before merge/ship)

Run everything in `docs/FULL_AUDIT_SUITE.md` against the complete
redesign-v1 branch before merging to `main`:
- Static checks clean.
- Fresh bug bounty specifically targeting the NEW surface area (side
  panel state management, profile switching/data isolation, Start
  Screen launch-path branching) — this is new code with new failure
  modes, not a re-audit of already-covered features.
- Live CDP verification of the full user journey: launch → Start Screen
  → pick/create profile → open a board → use the side panel (all three
  sections) → switch profiles → relaunch and confirm state persisted
  correctly.
- Persona pass specifically re-run (the VFX artist / casual user /
  plugin developer scripts) since the entire navigation model changed —
  don't assume last cycle's persona findings still apply.
- Full documentation pass (CHANGELOG/HANDOFF/ROADMAP/SECURITY/README).

**This phase is the gate.** Nothing merges to `main` until it's clean —
same bar as every other milestone release this project has shipped.

### Audit run — auto-hide toolbar + custom tooltips (2026-09-14)

Triggered by direct feedback on the auto-hide toolbar (hover-reveal not
firing, reveal/hide sharing one speed, revealed toolbar covering the
side-panel rail icons) plus a request to replace native OS tooltips
app-wide. Full findings and fixes are in this cycle's CHANGELOG entry
(`## [Unreleased]`); summary of what this suite specifically verified:

- **Static checks**: `node test/lint.js` and `node test/validate.js`
  both clean.
- **Bug bounty**: grep-based cross-module reference sweep — every
  `KanvazX.method(...)` call touched or added since v7.9.1 checked
  against that module's actual `return {...}` export list. Zero new
  instances of the "calls a method the target module doesn't have"
  bug class that this sprint kept finding earlier (Map View drag,
  Import button). Nothing new found.
- **Live CDP smoke test** (fresh Electron instance, port 9399, profile
  `pf_suite`): card creation for note/color/url/text types, side panel
  section switching (Boards/Properties/Settings), Map View toggle (4
  nodes, no exceptions), template listing (14 confirmed), profile
  listing (1 active, correctly shaped), annotation toolbar activation,
  tooltip title-suppression, and error logging (`getRecentErrors()`
  recorded a test error correctly) — zero `Runtime.exceptionThrown`
  events across the whole run. Electron's own stdout log reviewed
  after the run: clean, no warnings beyond the expected DevTools
  listening line.
- **Auto-hide toolbar hover-reveal specifically**: could not reproduce
  the reported non-reveal via CDP-simulated mouse input, across a
  single hover and a full reveal → hide → re-reveal cycle, both before
  and after the fix. `-webkit-app-region: drag` regions are a known
  spot where real OS hit-testing and CDP's simulated
  `Input.dispatchMouseEvent` can diverge — treated as a real-world-only
  risk, mitigated defensively (see CHANGELOG) rather than "fixed" with
  certainty from CDP alone. If this is reported again after the
  mousemove-fallback ships, it needs a real hands-on repro, not another
  CDP pass.
- **Not run this cycle**: full persona pass (scope was a targeted
  bugfix + one UI-wide but low-risk polish item, not a new feature
  surface — see "What run full suite does NOT mean" in
  `docs/FULL_AUDIT_SUITE.md`).

## Explicitly out of scope for this sprint

- Native `.blend`/`.mb` 3D format support — researched and declined, see
  `docs/ROADMAP.md`.
- Real per-profile board *ownership* (profiles partition preferences,
  not documents — see `docs/PROFILES_SYSTEM_PLAN.md`'s "what a profile
  owns" section).
- Any actual visual/pixel-level design work — that's your Figma pass;
  this sprint builds the structure it plugs into.
