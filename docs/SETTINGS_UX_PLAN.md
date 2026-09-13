# Settings Panel — UX Rework Plan (plan only, not implemented)

Written for reference while redesigning Kanvaz's UI in Figma. This covers
information architecture and interaction patterns only — visual design
(colors, spacing, typography) is intentionally left to that redesign.

## Current state

A single fixed-position popover (280px wide, right-anchored under the
titlebar button), one flat scrolling list, 8 section labels, 18 settings
total:

```
Appearance    — theme, minimap, grid lines, card shadows, animations
Behavior      — startup, confirm-delete, left-drag-pan, auto-hide chrome,
                dbl-click-note, grid snap, snap increment  (6 unrelated toggles)
Window        — always-on-top                              (1 setting, orphaned)
Smart Search  — enabled toggle                              (1 setting, orphaned)
Files         — autosave interval, default card width
Reset         — reset button
Developer     — FPS overlay, show IDs, run diagnostics
```

## Problems with this structure

1. **"Window" and "Smart Search" are one-setting sections.** A section
   header implies a category worth grouping — a single toggle under its
   own header reads as visual noise, not organization. Both settings are
   real and worth keeping, just not worth their own heading.
2. **"Behavior" is a grab-bag.** Startup behavior, delete confirmation,
   canvas panning, chrome auto-hide, note creation, and grid snapping
   have no real thematic connection to each other beyond "not
   Appearance." A user looking for "how do I stop it snapping to grid"
   has no logical section to guess first.
3. **No search or filter.** At 18 settings this is tolerable; it won't
   stay tolerable as the app grows (this session alone nearly added a
   19th before Reference Mode was removed). Most apps this size
   (VS Code, Photoshop, even Chrome) add settings search well before 20
   entries.
4. **Developer settings are unconditionally visible to everyone.**
   FPS overlay / show IDs / diagnostics are debugging tools, not
   something a VFX artist or hobbyist needs to see by default. Every
   other app in this category (Chrome's flags, VS Code's "workbench"
   internals) either hides developer settings behind an opt-in toggle
   or a separate "Advanced" area.
5. **Reset lives between Files and Developer** with no visual separation
   suggesting it's a different KIND of action (destructive, rarely
   used) than everything around it — a mis-click risk as the list grows
   and things shift position.
6. **Fixed narrow width (280px) constrains label length** — several
   labels already wrap or truncate awkwardly ("Double-click canvas
   creates note", "Auto-hide toolbar (hover top edge to reveal)").
   A wider or resizable panel would remove this constraint entirely
   rather than fighting it with ever-shorter labels.

## Proposed information architecture

Reorganize into 4 real categories instead of 8 fragments:

```
General        — theme, minimap, grid lines, card shadows, animations,
                  show recent on startup
Canvas & Input — left-drag-to-pan, auto-hide chrome, double-click note,
                  grid snap + increment, always-on-top
Files & Search — autosave interval, default card width, Smart Search,
                  confirm before delete
Advanced       — collapsed/hidden by default, one click to expand:
                  FPS overlay, show IDs, run diagnostics, Reset
```

Rationale for the groupings:
- **General** = "how Kanvaz looks and starts up" — genuinely visual/startup
  settings only.
- **Canvas & Input** = "how the infinite canvas responds to your mouse" —
  every setting here changes a canvas *interaction*, which is the one
  thing they actually share. (Always-on-top is arguably window-level, but
  it's a single always-relevant toggle with nowhere better to live —
  folding it in here beats giving it its own heading.)
- **Files & Search** = "things about your data and finding it" — autosave,
  card sizing (a save-format-adjacent default), and Smart Search fit
  together better than any alternative grouping tried.
- **Advanced** = destructive + developer-only, collapsed by default.
  Putting Reset here (not its own top-level section) signals "this is a
  rare, careful action" rather than something to browse past casually.

## Interaction pattern suggestions

- **Collapsible "Advanced" section**, closed by default, with a small
  chevron/disclosure — not a separate settings *mode*, just deprioritized
  by default visibility. One click reveals Developer tools + Reset.
- **A search/filter input at the top of the panel**, once the setting
  count passes ~20 (not urgent today, but design the panel so adding one
  later doesn't require a structural rework — leave room above the first
  section for it).
- **Consider a wider or resizable panel** instead of a fixed 280px — several
  labels are already fighting that constraint. A 320–360px default width
  would fix most current wrapping without needing to shorten any label.
- **Keep the single-scrolling-list pattern** rather than tabs — with only
  4 categories and ~18 settings, tabs add a click without saving enough
  scrolling to be worth the extra navigation step. Revisit if the total
  setting count roughly doubles.

## Explicitly out of scope for this plan

- Visual redesign (this is the user's own Figma pass).
- Adding new settings — this is purely a reorganization of what exists
  today.
- The actual search/filter *implementation* — flagged as "design room
  for it," not a request to build it now.
