---
title: "System requirements and performance"
layout: default
description: "What Kanvaz runs on, and how to keep large boards fast."
---

# System requirements and performance

*Verified against Kanvaz v9.8.2.*

## What it runs on

| System | Supported |
|---|---|
| Windows | 64-bit Windows (installer and portable). Windows 10 or later is the target, older versions are not tested |
| macOS | macOS 12 or later, Apple Silicon and Intel |
| Linux | 64-bit distributions that can run an AppImage |

These come from the build settings. Kanvaz is built on Electron, the same engine as many desktop apps, so a computer that runs a modern browser smoothly runs Kanvaz.

There is no official minimum RAM or graphics requirement, because none has been tested and published. Plain image boards are light. 3D previews, video and large PSD files are where memory use grows.

Kanvaz is a desktop app only. There is no web or mobile version.

## What makes a board heavy

- Many large images or videos open at once.
- 3D models with many triangles and 4K textures, especially in the heavier render modes.
- Big PDFs and PSD files previewed at high quality.
- Hundreds of cards visible on screen at the same zoom level.

## How to keep it fast

1. Lower Preview Quality. Settings, Preview Quality: Low, Medium or High limits how sharp 3D renders are, the PDF resolution and the size of Adobe-file previews. Low is the default. Use the per-card override in Properties for the one heavy card that needs more.
2. Hide what you are not using. The eye icon in the Layers panel (`Shift+L`) hides a card from the canvas, so there is less on screen to manage.
3. Split big boards. One `.kanvaz` file can hold several boards, each with its own view. Put separate projects on separate boards instead of one huge canvas.
4. Use file references for huge files. A file-reference card points at the original PDF or image instead of embedding a copy, which keeps the board file small.
5. Mind the 3D limit. 3D model cards accept files up to 150 MB.
6. Convert video that will not play. MKV and AVI may not play because of codec limits. MP4 (H.264) and WebM always do.
7. Pause what you are not watching. A playing video or audio card keeps working in the background.

## Checking where the time goes

Kanvaz has a developer FPS overlay (see the Developer tools entry in [Features](features.html)). If the frame rate drops only when a certain card is visible, that card is the heavy one. Hide it or lower its preview quality.

## Disk space

A board file contains every embedded asset, so its size is roughly the total size of the media you dropped in. The crash-recovery copy is written next to your settings and is cleared on a clean close. Kanvaz's `crash.log` is capped at 1 MB.

## When it is still slow

Open an issue with your version, your operating system, a rough description of the board (how many cards, what kinds) and the Export debug info text from the Command Palette. See [Contact and support](contact.html).
