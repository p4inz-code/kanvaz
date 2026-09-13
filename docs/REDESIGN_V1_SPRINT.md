# Kanvaz Redesign v1 — Sprint Plan

Tracks the `redesign-v1` branch (kept separate from `main` so the shipped
7.x line stays stable/testable throughout). Tag as "Kanvaz redesign v1"
internally; reconcile with the semver line at merge time.

Full detail for each phase lives in its own plan doc — this is the
sequencing and the definition of done.

## Phase 1 — Side panel — **DONE, on `redesign-v1`, not yet merged to `main`**

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

## Phase 2 — Start Screen + Profiles system — **Start Screen part DONE, on `redesign-v1`; Profiles system not started**

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

Remaining for this phase: the full offline Profiles system per
`docs/PROFILES_SYSTEM_PLAN.md` — sequenced as its own slice rather than
alongside the Start Screen fix above, since it touches real user data
(settings.json/recent.json/recovery/plugin-storage relocation +
migration) and deserves review on its own, not bundled into a smaller,
lower-risk fix.

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

## Phase 3 — Card visual polish

Not a plan doc — this phase consumes whatever comes out of your own
Figma pass (per `docs/SIDE_PANEL_PLAN.md`'s "Card visual modernization"
section: layered shadows, border treatment, hover elevation, card-bar
hierarchy). Implementation-only phase once you hand off specifics;
lands incrementally, doesn't block Phase 1/2 from shipping first.

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

## Explicitly out of scope for this sprint

- Native `.blend`/`.mb` 3D format support — researched and declined, see
  `docs/ROADMAP.md`.
- Real per-profile board *ownership* (profiles partition preferences,
  not documents — see `docs/PROFILES_SYSTEM_PLAN.md`'s "what a profile
  owns" section).
- Any actual visual/pixel-level design work — that's your Figma pass;
  this sprint builds the structure it plugs into.
