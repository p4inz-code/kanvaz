# v4.0.1 — Foundation Hardening Pass

A full bug-hunt audit across every file in the codebase, followed by fixes for everything it found. v4.0 is Kanvaz's last planned major version — this release is about making sure the foundation underneath it is solid before only small fixes ship from here on.

## Critical fixes

**Image fit, video speed, audio loop, and color format were silently lost on every save.** The save-file whitelist never listed these four fields — each worked perfectly for the rest of your session, then reverted to default the moment you reloaded the file. Undo/redo had the identical bug independently. Both are now fixed; old files that lost this data on a previous save will simply use the defaults going forward (the settings themselves weren't recoverable from an already-saved file, but nothing will be lost again).

**"Select All" only ever really selected one card.** Ctrl+A visually highlighted every card on the board, but Delete, Duplicate, Pin, and nudge afterward silently only acted on the last one. Multi-select is now real — bulk actions affect everything you selected, behind a single confirmation/undo step for the whole batch.

**Minimap click-to-pan was only accurate at exactly 100% zoom.** Clicking anywhere on the minimap now pans to the right spot regardless of zoom level.

## High-priority fixes

- Escape now actually cancels when renaming a board tab or typing a tag — it used to commit whatever you'd typed, identically to Enter.
- Fixed a macOS-specific edge case where closing and reopening a window could skip the "unsaved changes" warning.
- The app can no longer hang forever if the renderer process actually crashes.

## Also fixed

- Video/audio mute state now saves with the board.
- Tall portrait images no longer land absurdly oversized on the canvas.
- Clipboard-pasted audio now imports correctly.
- Deleting the active board no longer leaves orphaned connections behind.
- The `?` shortcuts overlay no longer lists "Cards" twice.
- The Properties panel can be closed with Escape or E again from anywhere inside it.
- Annotations now render crisp on HiDPI/Retina displays instead of slightly soft.

## Hardening

Tightened the CSP, hardened context menus against a future XSS path, made single-key shortcuts ignore unrelated focused controls, and a few defensive/performance cleanups.

Full technical writeup: see [CHANGELOG.md](CHANGELOG.md#401--foundation-hardening-pass).

## Download

Grab `Kanvaz Setup 4.0.1.exe` (installer) or `Kanvaz 4.0.1.exe` (portable) from the Releases page. Windows isn't code-signed — you'll see a SmartScreen warning on first run; click **More info → Run anyway**.
