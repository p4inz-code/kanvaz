# Side Panel Redesign — Architecture Plan (plan only, not implemented)

Replaces today's top tab strip (board switching) and separate Settings
popover / Properties panel with one unified, left-docked side panel,
toggled with `S`. Reference: user-provided Figma mockup (moodboard-style
board view with a left sidebar, card grid with type badges, top bar with
breadcrumb + account-style corner icon).

## Structure — icon-rail + content pane

```
┌─┬──────────────────────┐
│▤│  Boards               │  ← icon rail (~40px, always visible)
│⚙│  ─────────────────    │     picks which section shows in the
│ │  Board 1        5     │     wider content pane next to it
│ │  Board 2        2     │
│ │  + New board          │
│ │  ⬇ Quick drop         │
└─┴──────────────────────┘
```

Icon-rail sections:
- **Boards** — board list (replaces the top tab strip entirely — no
  coexistence), New board, Quick drop, per-board card count. Likely the
  section left open most of the time.
- **Properties** — today's separate per-card metadata panel, moved in
  here instead of its own slide-out.
- **Settings** — the reorganized 4-category structure from
  `docs/SETTINGS_UX_PLAN.md` (General / Canvas & Input / Files & Search /
  Advanced).
- **Profile** — see `docs/PROFILES_SYSTEM_PLAN.md`. Lives in the
  top-right corner icon (see below), not the left icon rail — different
  UI slot than Boards/Properties/Settings.

## Decisions (all resolved)

1. **Dock side** — **left**, matching the mockup.
2. **Collapsed state** — the icon rail stays **always visible** even when
   the wider content pane is closed; only the content pane opens/closes
   with `S`. Costs ~40px of canvas at rest, gives permanent wayfinding
   (you can always see Boards/Properties/Settings exist and click
   straight into one) instead of a shortcut you have to remember.
3. **Tab strip vs. sidebar** — sidebar **replaces the tab strip entirely**.
   No coexistence.
4. **`S` key scope** — **full replacement immediately**. The old Settings
   popover and its titlebar button are removed the moment this ships —
   one settings UI, not two living side by side.
5. **Branch strategy** — built on a **separate `redesign-v1` branch**,
   keeping the current shipped 7.x line stable/testable on `main` while
   this is mid-flight. Merge and reconcile version numbers when ready
   (tag as "Kanvaz redesign v1" per the user's request, separate from the
   semver line until merge).

## Corner icon (top-right, "where the acc space was")

Not a literal login avatar — Kanvaz has no accounts. Opens a menu with:
*Switch profile* / *Manage profiles* / *Edit this profile* (see Profiles
plan), then **About** and **Shortcuts** below, replacing the current
`Settings | About | ?` three-button cluster in the toolbar (Settings
already moved into the left panel per decision 4 above, so this cluster
shrinks to just the one corner icon).

## Also decided as part of this pass

- **Start Screen** (Premiere/Illustrator-style Home screen on plain
  launch, skipped when opening a `.kanvaz` file directly) — full detail
  lives in `docs/PROFILES_SYSTEM_PLAN.md` since it's also where the
  profile switcher surfaces for multi-profile installs, but it's launch
  UI shared by both plans.

## Card visual modernization (Figma pass, not this plan's scope)

Flagged for your own Figma redesign, not prescribed here — concrete,
specific reasons the current cards read as dated rather than exact new
values:
- Flat single-layer shadows (`box-shadow: 0 4px 16px rgba(0,0,0,.25)`) —
  layered shadows (tight dark + soft wide together) read as real depth.
- Hard 1px borders on every card — many modern flat-dark UIs drop the
  border entirely, relying on shadow + a subtle background-tint
  difference from the canvas instead.
- No hover elevation motion — hover only swaps outline/shadow instantly;
  a small `translateY` lift on hover is most of what makes Notion cards
  feel alive.
- Card-bar (filename strip) is plain text on a flat strip, no icon-first
  hierarchy.

## Sequencing

Build order: **side panel first** (it's the UI surface the profile
switcher and Start Screen both depend on), **then** the Profiles system,
**then** card visual polish can land incrementally as the Figma designs
come in — these three don't have to ship as one giant release.
