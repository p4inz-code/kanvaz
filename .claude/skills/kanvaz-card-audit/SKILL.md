---
name: kanvaz-card-audit
description: Audit Kanvaz cards visually (idle, hover, selected, resized) with real screenshots and measured overlap/clipping, and fix what it finds. Use when asked to audit, refine or verify card UI, or after any card CSS/layout change.
---

# Kanvaz card audit

Never claim a card looks right from reading CSS or DOM properties. The 3D hover strip was
"visible, opacity 1" for months while being clipped off screen; only a screenshot showed it.

## Two ways to render the real UI

1. **Real Electron (needs the owner's OK: they must say they are offline or ask for it).**
   Scratch profile only, and kill only the process whose command line has `remote-debugging-port=9333`:
   `electron.exe --remote-debugging-port=9333 --user-data-dir=<scratch> F:\OBL\Kanvaz`
   Then `node docs/handoff-assets/cdp/run.js tools/card-audit/build-in-app.js` builds one card of every
   type from `tools/card-audit/media` (dismisses the welcome screen, opens a board).
   `tools/card-audit/relayout.js` spreads them out and closes stray pickers.
2. **No Electron:** `preview_start` with name `card-audit` serves `src/` with a stubbed bridge
   (`tools/card-audit/`) into the Browser pane. Good for CSS and layout; anything that needs main
   (file dialogs, IPC, Blender) is stubbed and must be checked in real Electron.

## Per card, per state
States: idle, hover, selected, editing (note/text/url), and at a small and a large size, dark and light theme.
For each: real pointer events (CDP mouse move/click, or the pane's `computer` hover), then
- `KZAudit.focus(id)` centres the card at 100% (harness) and `KZAudit.audit(id)` measures overlaps between
  content elements, content outside the card, text cut off without an ellipsis, and buttons under 18px.
- Take a screenshot cropped to the card and LOOK at it. Automated output finds candidates; the eye decides.
- Record each defect as: card type, state, what is wrong, evidence (screenshot path or audit line).

## Fixing
Fix by type, smallest change, keep every existing control and piece of text. Style: purple, minimal,
human-looking; no glow, gradients or confetti. After each fix re-screenshot the same states and record
before and after. A hover overlay may cover the media, never the name/meta line.

## Reporting
Say exactly which states and card types were screenshotted and which were not. Commit locally; do not
push, tag or publish unless the owner says.
