---
title: "Full Feature List"
layout: default
---

# Full Feature List

*Moved out of the main README to keep it scannable. See the [Guide index](index.md) for everything else, or [Supported File Formats](file-formats.md) for the format table.*

## Canvas & organization
- Infinite pan/zoom canvas (8%–500%), multiple boards per file
- Real board thumbnails on the Home Screen (generated from the actual card layout at save time)
- 3D model cards (`.glb`/`.gltf`/`.obj`/`.fbx`/`.stl`/`.ply`/`.vox`/`.usd`/`.usdz`, up to 150MB, plus `.blend` if Blender is installed — auto-detected across drives, PATH, the registry and package managers, or chosen once and remembered): orbit with the mouse, 13 render modes (Shaded, Clay, Matcap, Wireframe, Wire on Shaded, Normals, Normal Map, Albedo, UV Grid, Roughness, Metalness, Occlusion, Alpha) grouped in one picker with unavailable modes greyed and explained, camera view presets and a turntable, animation playback with a clip picker and scrub bar, background color picker, read-only model stats (tris/verts/materials/textures/size). Alt+drag or Ctrl/Cmd+middle-mouse pans the whole board even with the cursor over the model — you're never trapped inside its orbit controls
- Adobe file previews (PSD/PSB/AI/XD/INDD): a real decoded preview inside the card, not just an icon — full flattened image for PSD/PSB, the PDF-compatible view for AI, the largest rendition for XD
- Open any supported file type from your OS's own "Open with" (Explorer, Finder, Linux file managers) — Kanvaz never takes over as the default handler for anything but its own `.kanvaz` boards
- Image, GIF, video, and audio cards with full playback controls and a real volume slider
- Note, text, color, URL, and file-reference card types. A file reference pointing at a `.pdf` or image gets a real inline preview inside the resizable card
- Shared cards across boards: same content, no duplication, edit anywhere
- Tag editing (Properties panel, with autocomplete from recent and board-wide tags), live search/filter (`/`), and Smart Folders (saved searches that re-run themselves)
- Color search: click a swatch, find every card that matches
- `.pur` file import via a toolbar button or drag-drop, both preserve position and scale
- Undo/redo up to 50 steps, autosave crash recovery, crash-safe atomic save
- Always-on-top by default (toggleable in Settings)
- Top Mode (`Ctrl+Shift+T`): one keystroke forces always-on-top, hides the toolbar chrome, and closes the side panel for a genuine floating-reference view — press it again to restore everything exactly as it was. Session-only, nothing is written to Settings
- MoodLock (the lock button next to Minimize in the titlebar, `Ctrl+Shift+L`, or the corner lock while Isolate View is on): isolates the selected cards and hides **every** piece of Kanvaz chrome (titlebar, toolbar, side panel and rail, status bar, minimap) so only the reference is left, forces always-on-top, and makes the board read-only so a stray click can't move anything. A small lock with a drag grip stays in the top-right corner to move the window and to unlock; `Ctrl+Shift+L` or `Esc` also unlock, and everything is restored exactly as it was. Session-only
- Presentation Mode (Command Palette): a read-only mode for showing a board to someone else — hides the toolbar and side panel, clears selection, steps card-by-card with the arrow keys, blocks every edit/drag/delete path while active. Escape restores everything exactly as it was

## Card design & templates
- Every card shows an always-visible name and at-a-glance metadata (resolution, duration, character count) plus one clean type badge
- Photoshop/Illustrator-style Properties panel: Transform (X/Y/W/H, drag the label to scrub the value live like Maya/Adobe/Figma — hold Shift for fine control), opacity, layer order, multi-select alignment, distribute-evenly, and Tidy Up, non-destructive Brightness/Contrast/Saturation for image/GIF/video, and Media info
- A Layers panel (its own side-panel tab): every card in z-order, click to select, drag to reorder, right-click for the full card menu, eye icon to hide/show, lock icon, star icon to highlight a layer (an accent border, independent from pin/lock), and a group indicator on grouped cards that selects every member in one click
- 14 board templates — VFX (three skill tiers: Beginner/Intermediate/Professional Pipeline), Game Dev, Game Art, Filmmaking, Music Production, Animation Pipeline, Photography/Concept Art, Architecture & Product Design, UI/UX Design, Branding & Identity, Character Design, and a freeform Mood Board — plus the option to save your own board (with its own Connections, if it has any) as a template. Every production-pipeline template has its own "drop your references here" section pointing at exactly the media (plates, concept art, a real 3D model card, and so on) that template's own process notes assume you already have on the board. 13 of the 14 — every one except the deliberately freeform Mood Board — also ship with real typed Connections between their own cards, demonstrating the actual pipeline dependency flow (a technical budget constraining an asset list, for instance) instead of a flat, disconnected note list

## Offline profiles
- Fully offline, no-login multi-profile system: switch, create, or add a guest profile, each with its own settings, recent boards, and recovery data
- Export a profile to a portable file and import it on another machine, no network involved
- Per-profile plugin enable-state and storage, so two people sharing one install don't step on each other's plugin setup

## Annotation
- Pen, highlighter, line, arrow, rectangle, ellipse, text stamp, pixel-measure, and eyedropper (real pixel sampling)
- Custom color picker with a recent-colors row, per-stroke opacity
- Video frame-stepping and onion-skin ghosting for checking animation timing
- Annotation toolbar scales with canvas zoom, so it doesn't shrink to nothing next to a zoomed-in card
- **Scratch Board** — a third view (alongside Board and Map) for board-wide, not-per-card annotation: Select/Pan, Pen, Highlighter, Line, Arrow, Rectangle, Ellipse, and a real Eraser (removes whole strokes it touches, not pixel erasing), with Illustrator-style Shift-constrain (0/45/90° snap on lines/arrows, perfect square/circle on shapes), adjustable brush color/width/opacity, and a configurable background (ruled lines / plain color / grid, each with its own color). Same cards, same camera as Board view — switching to Scratch doesn't change anything about how your cards behave

## Connections
- 7 typed relationship kinds (Related To, Inspired By, Derived From, Alternative To, Supports, Used In, References)
- Map View: node-editor-style graph, bezier tube connections, independent pan/zoom, real decoded-frame thumbnails on video and 3D model nodes (not a generic icon)
- Connection Inspector panel (C): view, create, edit, delete from a side panel

## Plugin ecosystem
- Drop a folder in, or one-click install from the in-app "Browse Official Plugins" catalog
- A richer runtime API: register card types, commands, themes, event hooks, even insert any card type from raw data
- MCP Bridge (official plugin): let an MCP-compatible AI client (Claude Desktop, Claude Code, and so on) read and edit your board locally, with every change undo-reversible
- AI Export (official plugin): export the current board or every board as a JSON + Markdown pair any AI agent can read — no MCP connection needed
- Template Maker & Manager (official plugin): save boards as templates, browse and install community ones
- Explicit, considered permission to sell your own plugin. No in-app marketplace, ever

## Everything else
- Command Palette (`Ctrl+K`): fuzzy-search and run any shortcut or plugin command
- Light/dark theme, type-aware context menus
- Settings migration across versions with zero data loss
- Developer tools: FPS overlay, ID overlays, one-click debug export for bug reports, with error toasts that actually show what went wrong
- Preview quality (Settings → Preview Quality): Low/Medium/High caps 3D render sharpness, PDF DPI and Adobe-file preview size — Low by default, with a per-card override in Properties for the one heavy card that needs to differ
