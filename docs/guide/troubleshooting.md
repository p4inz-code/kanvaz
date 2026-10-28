---
title: "Troubleshooting"
layout: default
description: "Fixes for the most common problems: windows, saving, media, 3D, plugins and updates."
---

# Troubleshooting

*Verified against Kanvaz v9.8.2.*

Find your symptom below. Every answer here comes from how Kanvaz actually behaves, not guesses. If yours is not listed, [tell us](#still-stuck) and it will be added.

## Install and launch

### Windows says "Windows protected your PC" / macOS says the app "cannot be opened"

Kanvaz is unsigned, so both systems warn the first time. It is expected.

- **Windows:** click **More info → Run anyway.**
- **macOS:** right-click (or Control-click) the app, choose **Open**, confirm once.

Details: [Installation & updates](installation.html#the-first-launch-unsigned-app-warnings).

### Which file do I download?

See the table in [Installation & updates](installation.html#which-file-do-i-download). In short: Windows `Kanvaz-Setup-<version>.exe`, Apple Silicon `…-arm64.dmg`, Intel Mac `….dmg` (no `-x64` in the name), Linux `.AppImage`.

## The window

### Kanvaz goes behind another app

Kanvaz is on top by default, and since v9.8.1 it re-raises itself when another app, such as ZBrush, takes the top. Check:

1. You are on **v9.8.1 or newer** (About screen, shortcut `I`). Older versions only set "on top" once.
2. **Settings → Canvas & Input → Always on top** is on. The Command Palette entry "Toggle Always on Top" flips it.
3. The other program is not in true **exclusive full-screen** (some games). Nothing can draw over those. Switch the program to windowed or borderless full-screen.

More: [Always on top, Top Mode & MoodLock](working-with-other-apps.html#always-on-top).

### The toolbar, side panel or status bar disappeared

You are in one of the modes that hides them:

| Mode | How to leave |
|---|---|
| **MoodLock** | `Esc`, `Ctrl+Shift+L`, or the lock in the top-right corner |
| **Presentation Mode** | `Esc` |
| **Top Mode** | `Ctrl+Shift+T`, or move the mouse to the top edge to reveal the toolbar |
| **Auto-hide toolbar** (a setting) | Move the mouse to the top edge, or turn it off in Settings |

### I cannot edit anything: cards will not move

MoodLock and Presentation Mode make the board **read-only on purpose**. Leave the mode (`Esc`) and editing returns.

### Some cards are missing from the board

- **Isolate View** (`Shift+I`) hides every card except the selection. Press `Shift+I` or `Esc`.
- A card hidden with the eye icon in the **Layers** panel (`Shift+L`) stays hidden until you show it.
- A search or **Smart Folder** filter may be dimming cards. Clear the search box.

### My shortcuts do nothing

- While you are typing in a text field, most shortcuts are suspended. The always-available ones (save, open, Command Palette, Home Screen, Top Mode, MoodLock) still work.
- In MoodLock and Presentation Mode only a short list of keys works. `Esc` always gets you out.
- Press `?` for the live shortcut list.

## Saving and files

### "File changed on disk" appears when I save

Kanvaz noticed that the `.kanvaz` file was saved by someone or something else after you opened it, for example a teammate on a shared drive. You get three choices:

- **Overwrite** replaces the file with what you have now.
- **Save as copy…** writes yours to a new file and leaves theirs alone.
- **Cancel** stops, your work stays open and unsaved.

It can also appear on folders handled by a sync client (Dropbox, OneDrive, Syncthing) that rewrites a file's timestamp after you saved. If you are sure nobody else edited the file, **Overwrite** is safe. Two saves landing in the same instant can still collide, so treat a shared file as one-person-at-a-time. See [Known limitations](known-limitations.html).

### Kanvaz crashed. Is my board gone?

Kanvaz writes an **autosave recovery file** every 30 seconds. After a real crash, the next launch offers **"Recover unsaved board?"**. Autosave is *only* a crash safety net: it never writes to your `.kanvaz` file, so save with **Ctrl+S** regularly. The recovery file is cleared on every clean close.

### The status bar still says "Unsaved changes"

That clears only when you save explicitly (**Ctrl+S**). Autosave does not clear it, by design.

### A card says "missing media"

Embedded media is checked with a hash when a board is saved and opened. If one asset in a file is damaged, only that card shows "missing media" and the rest of the board opens normally. A file-reference card (PDF and similar) shows this if the original file was moved or deleted.

### Can I open a PureRef file?

Yes: **Import → PureRef file** (`.pur`). Every card lands at its saved position and scale. See [Import & Export](import-export.html).

## Media and previews

### A video will not play

`.mkv` and `.avi` may fail because of a limitation in Chromium's codecs. Kanvaz tells you that this is the reason instead of a generic error. Convert to **MP4 (H.264)** or **WebM**, which always play.

### A `.blend` file shows only a file icon

Blender preview needs a **local Blender install**; Kanvaz has no `.blend` parser of its own. It looks at the usual install locations and your `PATH`. If yours is elsewhere, choose it in **Settings → Blender (.blend preview) → Choose…**. Without Blender, the file becomes a plain file-reference card. (Alternative: export `.glb` from Blender and drop that in.)

### A `.gltf` model looks untextured or incomplete

A `.gltf` that points at external `.bin` or texture files by relative path cannot be fully resolved, because Kanvaz embeds 3D models in the board. Use a self-contained `.gltf` or, better, a **`.glb`**. `.fbx` is supported on a best-effort basis.

### An `.exr` will not preview

Only **NONE and RLE** compression are supported. ZIP, PIZ, PXR24, B44 and DWA files are refused with a clear reason rather than shown wrong. Re-save the EXR with a supported compression.

### A PDF shows no text search

PDF cards support scrolling, zooming and page navigation only. There is no text selection or search inside a PDF yet.

### Search misses cards that obviously match

The plain search is exact text. **Smart Search** (fuzzy, "cars" finds "car") is **off by default**; turn it on in Settings. See [Command Palette & Smart Search](search-and-commands.html).

## Plugins

### "This plugin needs to be reviewed and approved first"

A plugin never runs until you approve the permissions it asks for. Open **Settings → Plugins** and use its enable control; Kanvaz shows what it wants to do. If a plugin's files changed since you approved it, or a new version asks for more permissions, you are asked again. See [Plugins](plugins.html).

### "Browse Official Plugins" shows nothing or an error

That button fetches a small catalog from GitHub only when you click it, so it needs an internet connection. Kanvaz works fully offline otherwise. You can also install a plugin from its `.zip` (**Add a Plugin…**).

## Updates

### "Check for updates" just opens a web page

On **macOS** (unsigned) and the **Windows portable** build there is no installed copy Kanvaz can replace, so it compares versions and hands you the release page. Download the new file there. The Windows installer and Linux AppImage can update in place.

## Collecting details for a bug report

The Command Palette (`Ctrl+K`) has **Export debug info**, which copies version and environment details to the clipboard, and **Run diagnostics** for Map View. Paste the first into your report.

## Still stuck?

- Open an issue: [github.com/p4inz-code/kanvaz/issues](https://github.com/p4inz-code/kanvaz/issues)
- Or email **atharva.patil.cg@gmail.com**. Kanvaz is a one-person project, so a clear message with your version and steps is the fastest way to a fix.
- Check [Known limitations](known-limitations.html) for things that are deliberate or not built yet.
