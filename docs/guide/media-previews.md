---
title: "Media Previews"
layout: default
---

# Media Previews

*Verified against Kanvaz v9.7.0.*

What Kanvaz can open and render a real, honest preview for — not just
a generic file icon — and register itself with your OS to open
directly ("Open with Kanvaz").

## Natively previewed formats

| Category | Formats |
|---|---|
| Image | JPG, JPEG, PNG, BMP, WEBP |
| Animated GIF | GIF |
| Video | MP4, WEBM, MOV, MKV, AVI — inline scrubbable player |
| Audio | MP3, WAV, OGG, M4A — with a waveform preview |
| 3D Model | GLB, GLTF, OBJ, FBX, STL, PLY, VOX, USD/USDA/USDC/USDZ |
| Blender File | `.blend` — Kanvaz uses a local Blender install to export a real thumbnail, if one is detected (see `blender-detect.js`) |
| PDF Document | PDF — page-by-page preview |
| Adobe File | PSD, PSB, AI, XD, INDD, INDT |
| HDR/EXR Image | Radiance `.hdr`/`.pic`, OpenEXR `.exr` — tone-mapped preview (not color-managed); some EXR compression methods aren't decoded yet |
| Krita File | `.kra` — reads the whole-canvas PNG Krita itself saves inside the file, not a per-layer thumbnail |

## 3D model modes

3D cards can render in several shading modes (Shaded, Normals, Matcap,
Wireframe, Albedo, Alpha), each preserving the model's real color,
opacity, and sidedness — switching modes never touches the original
material.

## Preview quality

Rendering for 3D/PDF/Adobe previews has a Low/Medium/High setting
(see [Settings](settings.md)) — pixel ratio, DPI, and max texture size
all climb together from Low to High. A card can also override the
global setting individually.

## What's deliberately not previewed

Formats without a real, trustworthy path to a preview stay as a
generic labeled file-reference card instead of guessing:
ZBrush `.ztl`, Houdini `.hip`/`.hipnc`, Cinema 4D `.c4d`, Maya
`.ma`/`.mb`, Clip Studio `.clip`, Procreate `.procreate`. None of
these have a headless/command-line export path the way `.blend` does
through a local Blender install, so Kanvaz doesn't claim to open them
at the OS level — a labeled file card is still fully usable (name,
tags, connections, notes all work), it just won't show a thumbnail.

## Related

- [Import & Export](import-export.md) — how these files get onto a board
- [Board View](board-view.md) — card types in general
