---
title: "Cookbook"
layout: default
description: "Step-by-step recipes for real jobs: moving from PureRef, referencing beside ZBrush, organizing a big board, presenting to a client and more."
---

# Cookbook

*Verified against Kanvaz v9.8.2.*

Each recipe is a real job from start to finish. They use features explained in more depth elsewhere, and every recipe links to the page that goes deeper.

## 1. Move over from PureRef

Goal: keep every board you already made.

1. Open Kanvaz and choose Import, then PureRef file (`.pur`). You can also drop the `.pur` file onto the canvas.
2. Every image lands as its own card at the position and scale it had in PureRef.
3. Check the result, then save with `Ctrl+S`. The new `.kanvaz` file holds the images inside it.
4. Repeat for your other boards.
5. Keep your old `.pur` files until you are happy with the result.

Good to know: the images and their layout come across. Kanvaz features with no PureRef equivalent, such as connections and tags, are yours to add after the import. See [Import and export](import-export.html).

## 2. A reference wall beside ZBrush or Blender

Goal: references stay visible while you sculpt, with no Kanvaz chrome in the way.

1. Make a board with your references, or open an existing one.
2. Select the cards you want to see. Select nothing to use the whole board.
3. Press `Ctrl+Shift+L` (or click the lock next to Minimize). Everything except those cards disappears and the window stays on top.
4. Make the window small and drag it by the grip in the top-right corner to the edge of your screen. Kanvaz remembers the spot for next time.
5. Press Left and Right to flip through the references. The corner shows where you are, for example 3 / 12.
6. Press `Esc` when you want to edit the board again.

If it ever slips behind your other app, see [Troubleshooting](troubleshooting.html#kanvaz-goes-behind-another-app). Full explanation: [Always on top, Top Mode and MoodLock](working-with-other-apps.html).

## 3. Start a character board from a template

1. From the Home Screen choose Browse templates.
2. Pick Character Design (there are 14 starters, including VFX, Game Art, Filmmaking, Photography and Concept Art, UI/UX and Branding).
3. Replace the placeholder cards by dropping your own images on them or next to them.
4. Edit the notes. The template's connections are already set up, so open Map View with `M` to see how the pieces relate.
5. Save as a new board. To keep your own layout as a template for next time, use the Template Maker plugin. See [Templates](templates.html).

## 4. Keep a huge board under control

Goal: a board with hundreds of cards that you can still find things in.

1. Tag as you go. Select cards, open Properties and add tags, which autocomplete from tags already on the board.
2. Save searches that matter. Search (`/`), then save the filter as a Smart Folder. It re-runs itself as the board changes.
3. Use the Layers panel (`Shift+L`) to hide what you are not using, lock what must not move, and star the few cards that matter most.
4. Group cards that belong together so they select as one.
5. Select a messy area and use Align, Distribute and Tidy Up in Properties.
6. Split unrelated work into separate boards inside the same file.

Related: [Side Panel](side-panel.html), [Command Palette and Smart Search](search-and-commands.html).

## 5. Check values and color on a reference

1. Select an image card and open Properties.
2. Drag Saturation down to see the values in black and white. Use Brightness and Contrast to push it. The original file is not changed.
3. Use the annotation eyedropper to sample real pixel colors, and the pixel-measure tool to check distances.
4. Click a color swatch card to find every card on the board with a matching color.

## 6. Mark up a reference for feedback

1. Select the card and press `A` to open the annotation toolbar.
2. Draw with the pen, highlighter, arrow, rectangle, ellipse or text stamp. Brush width and color are in Properties.
3. For marks that belong to the whole board instead of one card, switch to Scratch Board.
4. To send a flat image, right-click the card and choose Export as, then pick PNG, JPEG, WEBP or BMP and a scale.

See [Scratch Board](scratch-board.html) and [Import and export](import-export.html).

## 7. Plan a shot or a design with Map View

1. Put the pieces on the board: key images, a note for the idea, a color swatch for the palette, a 3D model for the prop.
2. Select a card and press `C` to open the Connections inspector. Add a connection to another card and pick a type such as Inspired By, Derived From or Used In.
3. Press `M` to switch to Map View. Every card is a node and every connection is a cable you can drag.
4. Add notes and a priority to connections that need explaining.

See [Map View](map-view.html).

## 8. Present a board to a client

1. Arrange the cards in the order you want to show them. Presentation Mode steps in reading order, top to bottom and left to right.
2. Open the Command Palette (`Ctrl+K`) and run Toggle Presentation Mode.
3. Use the arrow keys to step from card to card. The board is read-only, so nothing moves by accident.
4. Press `Esc` to leave. Everything returns exactly as it was.

## 9. Back up and hand over a project

1. Copy the `.kanvaz` file. Images, video, audio and 3D models are inside it.
2. Copy any file-reference targets (such as PDFs) alongside it, or re-link them on the other machine.
3. Optional: use the AI Export plugin to write a JSON and Markdown copy anyone can read without Kanvaz.
4. To move your whole setup to a new machine, export your profile and import it there. See [Profiles](profiles.html).

## 10. Let an AI assistant tidy a board

1. Install and enable the MCP Bridge plugin from Settings, then Plugins, and approve its permissions.
2. Point your AI client (Claude Desktop or Claude Code, for example) at the bridge as described in [MCP Bridge](mcp-bridge.html).
3. Ask it to read the board, group related cards, add tags or align layouts.
4. Every change can be undone with `Ctrl+Z`, like anything you do by hand.

## Where to go next

- [Keyboard shortcuts](shortcuts.html): every key in one table.
- [FAQ](faq.html): quick answers.
- [Workflows by domain](workflows.html): how VFX, 3D, game and film artists use Kanvaz.
