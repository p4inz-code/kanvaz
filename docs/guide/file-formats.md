---
title: "Supported File Formats"
layout: default
---

# Supported File Formats

*Moved out of the main README to keep it scannable — this is the full reference. See the [Guide index](index.md) for everything else.*

"Real preview" means Kanvaz decodes the file itself and shows actual content inside the card (an image, a rendered 3D model, an extracted thumbnail) — not just a filename and an icon. Kanvaz only registers OS-level "Open with Kanvaz"/file-association support for formats it can show something real for — a format with no preview path doesn't get associated at all right now, rather than becoming a bare labeled placeholder card. Formats without a working preview are listed under **Planned** below instead of in the main table.

| Format | Extensions | Status |
|---|---|---|
| Image | `.jpg` `.jpeg` `.png` `.bmp` `.webp` | ✅ Real preview |
| Animated GIF | `.gif` | ✅ Real preview (plays inline) |
| Video | `.mp4` `.webm` `.mov` | ✅ Real preview (plays inline) |
| Video | `.mkv` `.avi` | ⚠️ Recognized — may not play (Chromium codec limitation) |
| Audio | `.mp3` `.wav` `.ogg` `.m4a` | ✅ Real preview (plays inline) |
| 3D Model | `.glb` `.gltf` `.obj` `.stl` `.ply` `.vox` `.usd` `.usda` `.usdc` `.usdz` | ✅ Real preview — orbit, 13 render modes |
| 3D Model | `.fbx` | ✅ Real preview — best-effort (most complex/least standardized of the group) |
| 3D Model (materials) | `.mtl` (companion to `.obj`) | ✅ Auto-detected and applied |
| Blender | `.blend` | ✅ Real preview, if Blender is installed locally (auto-detected or chosen once in Settings) — otherwise a labeled file-reference card |
| PDF | `.pdf` | ✅ Real preview — scroll/zoom/page nav (no text selection or search-within-PDF yet) |
| Adobe | `.psd` `.psb` `.ai` `.xd` | ✅ Real preview — full flattened image (PSD/PSB), PDF-compatible view (AI), largest rendition (XD) |
| Adobe | `.indd` `.indt` | ⚠️ Recognized, no preview |
| HDR / EXR | `.hdr` `.pic` | ✅ Real preview — tone-mapped from real HDR data |
| HDR / EXR | `.exr` | ✅ Real preview — NONE/RLE compression only; ZIP/PIZ/PXR24/B44/DWAA/DWAB refused with a clear reason instead of a wrong image |
| Krita | `.kra` | ✅ Real preview — extracts the document's own embedded composite |
| Alembic | `.abc` | ❌ Not supported — deliberately deferred, no safe reference implementation available yet (see [ROADMAP.md](https://github.com/p4inz-code/kanvaz/blob/main/docs/ROADMAP.md)) |
| PureRef | `.pur` | ✅ Real import — every card at its saved position/scale |

**Planned** (no OS-level file association yet — no real preview path exists today, so Kanvaz doesn't claim to open these until one does): ZBrush (`.ztl`), Houdini (`.hip`/`.hipnc`), Maya (`.ma`/`.mb`), Cinema 4D (`.c4d`), Clip Studio Paint (`.clip`), Procreate (`.procreate`). Houdini and Maya are the most likely to follow Blender's own pattern (an optional local-install external-tool conversion); the others have no realistic path yet — see [ROADMAP.md](https://github.com/p4inz-code/kanvaz/blob/main/docs/ROADMAP.md) for the reasoning per format.

## File format internals

As of 4.1.0, a `.kanvaz` file is a zip container: `board.json` (the board/card/connection structure) plus one file per embedded image/video/audio asset, each with a SHA-256 hash recorded for corruption detection. This replaced the old plain-JSON-with-everything-base64-encoded format, which inflated media by about 33% and put your whole board at risk if a single byte anywhere in that one giant JSON string got corrupted. A damaged asset now degrades to that one card showing "missing media" instead of threatening the rest of the file.

As of 6.4.0, `board.json` also carries a top-level `sharedCards` registry. The content of any card shared across boards lives there once, keyed by a stable id, with each board's own `cards[]` holding only a lightweight position/size stub that references it. This is fully additive: older files simply have no stubs referencing anything and load with an empty registry.

Files saved by 4.0.1 and earlier (plain JSON, base64 media) still open exactly as before. Kanvaz detects the format automatically and only ever writes the current container going forward. Connections are stored as a top-level `connections` array alongside boards. Files from v2.x load cleanly with zero connections.
