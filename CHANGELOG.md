# Changelog

All notable changes to Kanvaz are documented here.

## [3.0.0] — Reference Connection System
Kanvaz evolves from a reference board into a Reference Operating System.

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

## [2.0.1] — Final release
- Identity update: now made by Atharva Patil (Northbyte Studios).
- Updated docs and in-app About screen to reflect final-release status.

## [2.0.0] — Final release
- Declared feature-complete. No further development planned.
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
