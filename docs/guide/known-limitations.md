---
title: "Known Limitations"
layout: default
---

# Known Limitations

*Moved out of the main README to keep it scannable. See the [Guide index](index.md) for everything else. These are stated plainly on purpose — no known rough edge is hidden.*

- Custom key-value properties are text values only, no dropdown/date/number field types yet.
- MKV and AVI video files may not play (a Chromium codec limitation). MP4 (H.264) and WebM are recommended. Kanvaz tells you plainly when this is why a video card failed, instead of a generic "missing media" message.
- `.blend` preview requires a local Blender install (checked at a few common install locations, or on your system `PATH`) — Kanvaz has no `.blend` parser of its own, since none exists that's safe to bundle. Without Blender found, a dropped `.blend` file becomes a plain file-reference card instead of failing outright. Maya (`.mb`/`.ma`) and Houdini formats aren't supported yet — planned as the same kind of optional-external-tool conversion, not yet built.
- PDF preview only covers viewing (scroll/zoom/page nav). There's no text selection, search-within-PDF, or annotation on top of a PDF page yet.
- Cross-board connections between two independent cards aren't possible from the UI (only one board's cards load at a time, so the "Connect to" picker only offers cards on the board you're on). As of 6.4.0, sharing the *same* card across boards is possible and covers most of what people actually want this for.
- Autosave writes to a recovery file only. "Unsaved changes" in the status bar clears only on explicit Save (Ctrl+S). The recovery file is cleared on every clean close, so the "Recover unsaved board?" prompt only appears after an actual crash.
- The base installer bundles zero plugins by design (see [SECURITY.md](https://github.com/p4inz-code/kanvaz/blob/main/SECURITY.md)'s Plugin System section). Theme Creator, MCP Bridge, AI Export, and Template Maker & Manager all install separately, the same way any third-party plugin does.
- `registerPropertyFieldType` (custom Properties panel field types via a plugin) is still unimplemented.
- 3D model cards embed the file (like image/video/audio) rather than pointing at it. A `.gltf` that references external `.bin`/texture files by relative path won't fully resolve (only a self-contained `.gltf` or a `.glb` is guaranteed to render everything); `.fbx` support is best-effort, since it's the most complex and least standardized of the four formats. Custom user-swappable textures aren't supported yet (planned as a future plugin).
- Per-profile plugin *storage* is isolated, but installed plugin code is still shared across all profiles on one machine, since installing a plugin is treated as a machine-level action, not a per-profile one.
- Materials built from procedural nodes (noise, gradients) have no image to export from `.blend`, so they come through as a flat colour.
- Presentation Mode steps through cards in the order they were created, not left-to-right/top-to-bottom reading order.
- The macOS build isn't code-signed yet (no Apple Developer ID), so it can't auto-install updates or register as a default file handler the way the Windows build can — "Check for updates" and "Open with" both fall back to a direct link/manual step there instead.
