---
title: "Workflows by Domain"
layout: default
---

# Workflows by Domain

*Moved out of the main README to keep it scannable. See the [Guide index](index.md) for everything else.*

Same canvas, three example pipelines — start from whichever is closest to your own work.

## VFX / previz
1. New Board → pick one of the three VFX templates as a starting layout.
2. Drop reference plates and 3D blocking (`.glb`/`.obj`/`.fbx`/`.usd`/`.usdz`, or `.blend` directly if Blender is installed) straight onto the canvas.
3. Tag by shot (`SEQ010`, `approved`) and save that search as a Smart Folder — it re-runs itself as new references land.
4. Connect a plate to its matching 3D blockout with a "Derived From" link, then open Map View to see the whole shot's reference graph at once.
5. Annotate on top of a frame (pixel-measure, eyedropper) instead of switching to a separate markup tool.
6. Once the layout settles, save the board as a template so the next shot starts from the same structure.

## 3D / look-dev
1. Drop a model onto the canvas and orbit it, switch Normal/Wireframe/Matcap shading, and scrub any embedded animation without leaving the board. Camera framing is remembered per card between sessions.
2. Place reference photos, HDRIs, or material swatches next to the model for direct side-by-side comparison during look-dev.
3. Use "Alternative To" connections between competing material passes so a reviewer sees every option tried, not just the final pick.
4. Share the same model card across a lighting board and a modeling board — editing it on either one updates both, no duplicate files.

## Game dev
1. Start from the Game Dev template; drop concept art and exported asset previews (images or 3D models) onto one board.
2. Track status with tags (`blockout`, `in-progress`, `approved`) — a live filter or Smart Folder shows what's still outstanding at a glance.
3. Use Map View as a lightweight dependency graph: "Used In" connections from a shared prop/model to every level or scene that references it.
4. Export the board as a `.kanvaztemplate` and hand it to teammates so a new asset or level starts from the same layout.

## Handing a pipeline to a team
Board layout and app setup travel as two separate portable files, no account or server on either end: **Save current board as template** (Template Maker & Manager plugin) exports a `.kanvaztemplate`; **Settings → Manage Profiles → Export** on any profile produces a `.kanvazprofile` carrying that profile's settings, recent-boards list, and plugin enable-state. Send both however your team already shares files — the other person imports the template from the Template Maker & Manager plugin's **Import Template…** button and the profile via **Manage Profiles → Import Profile…**, and starts from an identical setup.
