---
title: "Supported File Formats"
layout: default
description: "Every file type Kanvaz can import, preview or export, plus how the .kanvaz file is built."
---

# Supported file formats

*Moved out of the main README to keep it scannable. This is the full reference. See the [Guide index](index.html) for everything else.*

"Real preview" means Kanvaz decodes the file itself and shows actual content inside the card (an image, a rendered 3D model, an extracted thumbnail), not just a filename and an icon. Kanvaz only registers OS-level "Open with Kanvaz"/file-association support for formats it can show something real for, a format with no preview path doesn't get associated at all right now, rather than becoming a bare labeled placeholder card. Formats without a working preview are listed under **Planned** below instead of in the main table.

| Format | Extensions | Status |
|---|---|---|
| Image | `.jpg` `.jpeg` `.png` `.bmp` `.webp` | Real preview |
| Animated GIF | `.gif` | Real preview (plays inline) |
| Video | `.mp4` `.webm` `.mov` | Real preview (plays inline) |
| Video | `.mkv` `.avi` | Recognized, may not play (Chromium codec limitation) |
| Audio | `.mp3` `.wav` `.ogg` `.m4a` | Real preview (plays inline) |
| 3D Model | `.glb` `.gltf` `.obj` `.stl` `.ply` `.vox` `.usd` `.usda` `.usdc` `.usdz` | Real preview, orbit, 13 render modes |
| 3D Model | `.fbx` | Real preview, best-effort (most complex/least standardized of the group) |
| 3D Model (materials) | `.mtl` (companion to `.obj`) | Auto-detected and applied |
| Blender | `.blend` | Real preview, if Blender is installed locally (auto-detected or chosen once in Settings), otherwise a labeled file-reference card |
| PDF | `.pdf` | Real preview, scroll/zoom/page nav (no text selection or search-within-PDF yet) |
| Adobe | `.psd` `.psb` `.ai` `.xd` | Real preview, full flattened image (PSD/PSB), PDF-compatible view (AI), largest rendition (XD) |
| Adobe | `.indd` `.indt` | Recognized, no preview |
| HDR / EXR | `.hdr` `.pic` | Real preview, tone-mapped from real HDR data |
| HDR / EXR | `.exr` | Real preview, NONE/RLE compression only; ZIP/PIZ/PXR24/B44/DWAA/DWAB refused with a clear reason instead of a wrong image |
| Krita | `.kra` | Real preview, extracts the document's own embedded composite |
| Alembic | `.abc` | Not supported, deliberately deferred, no safe reference implementation available yet (see [ROADMAP.md](https://github.com/p4inz-code/kanvaz/blob/main/docs/ROADMAP.md)) |
| PureRef | `.pur` | Real import, every card at its saved position/scale |

**Planned** (no OS-level file association yet, no real preview path exists today, so Kanvaz doesn't claim to open these until one does): ZBrush (`.ztl`), Houdini (`.hip`/`.hipnc`), Maya (`.ma`/`.mb`), Cinema 4D (`.c4d`), Clip Studio Paint (`.clip`), Procreate (`.procreate`). Houdini and Maya are the most likely to follow Blender's own pattern (an optional local-install external-tool conversion); the others have no realistic path yet, see [ROADMAP.md](https://github.com/p4inz-code/kanvaz/blob/main/docs/ROADMAP.md) for the reasoning per format.

## File format internals

<figure class="diagram">
<svg viewBox="0 0 720 250" role="img" aria-labelledby="ff-t ff-d" xmlns="http://www.w3.org/2000/svg">
  <title id="ff-t">What is inside a .kanvaz file</title>
  <desc id="ff-d">A .kanvaz file is a zip container holding board.json and one file per embedded asset, each checked with a SHA-256 hash.</desc>
  <rect x="20" y="16" width="680" height="218" rx="18" fill="var(--bg-2)" stroke="var(--line)"/>
  <text x="40" y="46" font-size="16" font-weight="700" fill="var(--text)">my-board.kanvaz  (a zip container)</text>
  <rect x="40" y="64" width="290" height="150" rx="12" fill="var(--accent-bg)" stroke="var(--accent)"/>
  <text x="58" y="92" font-size="15" font-weight="700" fill="var(--accent)">board.json</text>
  <g font-size="13.5" fill="var(--text-2)">
    <text x="58" y="120">boards, cards and their positions</text>
    <text x="58" y="142">connections and tags</text>
    <text x="58" y="164">shared-card registry</text>
    <text x="58" y="186">one hash for every asset</text>
  </g>
  <g>
    <rect x="360" y="64" width="150" height="40" rx="10" fill="var(--bg-3)" stroke="var(--line)"/><text x="376" y="89" font-size="13.5" fill="var(--text)">image-01.png</text>
    <rect x="530" y="64" width="150" height="40" rx="10" fill="var(--bg-3)" stroke="var(--line)"/><text x="546" y="89" font-size="13.5" fill="var(--text)">clip-02.mp4</text>
    <rect x="360" y="116" width="150" height="40" rx="10" fill="var(--bg-3)" stroke="var(--line)"/><text x="376" y="141" font-size="13.5" fill="var(--text)">model-03.glb</text>
    <rect x="530" y="116" width="150" height="40" rx="10" fill="var(--bg-3)" stroke="var(--line)"/><text x="546" y="141" font-size="13.5" fill="var(--text)">sound-04.wav</text>
  </g>
  <text x="360" y="186" font-size="13.5" fill="var(--text-2)">Each asset is checked with SHA-256 when the</text>
  <text x="360" y="206" font-size="13.5" fill="var(--text-2)">board opens. A damaged one only turns its own</text>
  <text x="360" y="226" font-size="13.5" fill="var(--text-2)">card into "missing media".</text>
</svg>
<figcaption>Any zip tool can open a .kanvaz file, so your media is never locked inside.</figcaption>
</figure>

As of 4.1.0, a `.kanvaz` file is a zip container: `board.json` (the board/card/connection structure) plus one file per embedded image/video/audio asset, each with a SHA-256 hash recorded for corruption detection. This replaced the old plain-JSON-with-everything-base64-encoded format, which inflated media by about 33% and put your whole board at risk if a single byte anywhere in that one giant JSON string got corrupted. A damaged asset now degrades to that one card showing "missing media" instead of threatening the rest of the file.

As of 6.4.0, `board.json` also carries a top-level `sharedCards` registry. The content of any card shared across boards lives there once, keyed by a stable id, with each board's own `cards[]` holding only a lightweight position/size stub that references it. This is fully additive: older files simply have no stubs referencing anything and load with an empty registry.

Files saved by 4.0.1 and earlier (plain JSON, base64 media) still open exactly as before. Kanvaz detects the format automatically and only ever writes the current container going forward. Connections are stored as a top-level `connections` array alongside boards. Files from v2.x load cleanly with zero connections.
