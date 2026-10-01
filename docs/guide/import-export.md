---
title: "Import & Export"
layout: default
---

# Import & Export

*Verified against Kanvaz v9.7.0.*

Every way media gets onto a Kanvaz board, and every way it comes back
out.

## Getting media in

| Method | What it does |
|---|---|
| **Drag and drop** | Drop any supported file straight onto the canvas — lands as a card at the drop point |
| **Ctrl+V (paste)** | Pastes an image from your clipboard as an image card. Text paste is deliberately *not* wired to card creation — use right-click → Add Note for that. |
| **Import → PureRef file (.pur)** | Migrates an existing PureRef board — every image becomes its own Kanvaz card, laid out to match the original positions. Runs off the main thread (a worker), so it stays responsive even on a board with hundreds of images. |
| **"Open with Kanvaz"** | Any file type Kanvaz registers itself for (see [Media Previews](media-previews.md)) can be opened directly from your OS file manager or command line |
| Right-click → Add | Text note, color swatch, or URL reference — cards that don't come from a file |

## Getting media out

### Export as image

Right-click a selection of image/GIF/video cards → **Export as…**.
Each card is re-encoded independently into its own file — this is
distinct from a board screenshot; it's a genuine format converter for
material you've already collected, so you never need to visit an
external site to convert a file.

| Format | Notes |
|---|---|
| PNG | Lossless, default |
| JPEG | Lossy, adjustable quality |
| WEBP | Lossy, adjustable quality |
| BMP | Uncompressed 24-bit, hand-rolled encoder (added by direct request — Chromium's canvas API doesn't produce BMP natively) |

A video card's export is explicitly labeled "current frame" — Kanvaz
has no video encoder, so this always exports a still, never the clip.

Exporting a single card opens a save dialog; exporting several opens a
batch save (pick a folder, get one file per card).

### Export a profile

See [Profiles](profiles.md) — a whole profile (settings, recent list,
recovery data) exports as a portable `.kanvazprofile` file.

### Export a template

See [Templates](templates.md) — a saved template exports as a
`.kanvaztemplate` file you can hand to someone else.

## Related

- [Media Previews](media-previews.md) — every file type Kanvaz can open and preview
- [Templates](templates.md) — starting from a curated layout instead of importing your own files
- [MCP Bridge](mcp-bridge.md) — an AI assistant can call `createCard` directly, another path media can enter a board
