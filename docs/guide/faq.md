---
title: "FAQ"
layout: default
description: "Fast answers to the questions people ask most about Kanvaz, grouped by topic."
---

# Frequently asked questions

*Verified against Kanvaz v9.8.2.*

Short answers first, with a link to the full page when there is one. Can't find yours? Press `/` to search the whole guide, or see [Contact and support](contact.html).

## The basics

### Is Kanvaz really free?

Yes. It is open source under the MIT license. There is no paid tier, no trial and no account. The [support page](https://p4inz-code.github.io/donate/) exists if you want to chip in, and nothing is locked behind it.

### Can I use it for commercial work?

Yes. The MIT license allows commercial use, and the boards and files you make are yours. Read the [license](https://github.com/p4inz-code/kanvaz/blob/main/LICENSE) if you need the exact wording for a contract.

### Is there a smaller, quicker version?

Yes, Kanvaz Mini. It is a separate app: a tiny always-on-top window you drop images into, with no setup. Kanvaz stays the tool for heavy work. See [Kanvaz Mini](kanvaz-mini.html).

### Which systems does it run on?

64-bit Windows, macOS 12 or later (Apple Silicon and Intel) and Linux (AppImage). It is a desktop app. There is no web version and no phone or tablet app.

### Does it need an internet connection?

No. Everything works offline. The only things that touch the network are buttons you press yourself: Check for updates, Browse Official Plugins, installing a plugin, browsing community templates and URL-card previews. See [Privacy and your data](privacy-and-your-data.html) for the complete list.

### Do I need an account?

No. There is no sign-up, login or user identity of any kind.

### How is it different from PureRef?

Kanvaz adds typed connections with a Map View, live 3D model previews, video and audio playback, PDF and Adobe previews, plugins and an AI bridge. PureRef is lighter and has a longer track record. The honest comparison is in the [README](https://github.com/p4inz-code/kanvaz#how-kanvaz-compares), and a smaller "Mini" mode is being planned for people who want the minimal version.

## Getting set up

### Windows says "Windows protected your PC". Is that safe?

It is the normal warning for unsigned software, because Kanvaz is not code-signed. Choose More info, then Run anyway. You can compare your download with the `SHA256SUMS-*.txt` file on the same release. Full steps in [Installation and updates](installation.html).

### Which download do I pick?

Windows: `Kanvaz-Setup-<version>.exe` (installer) or `Kanvaz-<version>.exe` (portable). Apple Silicon Mac: `-arm64.dmg`. Intel Mac: the `.dmg` without a suffix. Linux: `.AppImage`.

### Can I run it from a USB stick?

Yes, with the Windows portable build. It leaves nothing installed. Settings and recovery data are still stored in your user data folder on that computer.

### How do I update?

About screen (`I`) then Check for updates. The Windows installer and the Linux AppImage can update themselves. On macOS and with the Windows portable build you download the new file from the release page. Your boards are not touched by updates.

### How do I uninstall it?

Windows installer: Settings, Apps, Kanvaz, Uninstall. Portable and AppImage: delete the file. macOS: drag the app to the Trash. Your `.kanvaz` boards stay where you saved them.

## Your files and your work

### Where are my boards?

Wherever you saved them. A board is one ordinary `.kanvaz` file. Kanvaz never uploads or syncs anything.

### How do I back up my work?

Copy the `.kanvaz` files, the same way you back up any document. Use your normal backup tool or a cloud-synced folder. For a whole setup (settings, recent boards, plugin state) export your profile from the profile menu, see [Profiles](profiles.html).

### How do I move boards to another computer?

Copy the `.kanvaz` file. Images, video, audio and 3D models are embedded in it, so nothing is left behind. File-reference cards (for example a PDF) point at the original file, so copy those files too or re-link them.

### Can I open a board without Kanvaz?

A `.kanvaz` file is a zip container: a `board.json` plus one file per embedded asset. Any zip tool can open it and you can read your media back out. See [Supported file formats](file-formats.html).

### Kanvaz crashed. Did I lose my work?

Kanvaz writes a recovery copy every 30 seconds and offers it on the next launch after a crash. That copy is a safety net only, so save with `Ctrl+S` regularly. More in [Troubleshooting](troubleshooting.html#kanvaz-crashed-is-my-board-gone).

### Can two people edit the same board?

Not at the same time. If a board is on a shared drive and someone else saves it, Kanvaz notices and asks whether to overwrite, save a copy or cancel, so nobody's work is silently erased. Treat a shared file as one editor at a time.

### How many undo steps do I get?

Up to 50, for undo and redo.

### Is my board safe if a file is damaged?

Each embedded asset has a SHA-256 hash. A damaged asset only turns its own card into "missing media". The rest of the board opens normally.

## Working with references

### Can I import a PureRef board?

Yes. Import a `.pur` file from the toolbar or drop it onto the canvas. Every image becomes a card at its saved position and scale. See [Import and export](import-export.html).

### How do I add images?

Drag files in from your file manager, paste an image from the clipboard (`Ctrl+V`), use Import, or right-click the canvas to add a note, color swatch or URL card. Pasted text is not turned into a card on purpose, so use the right-click menu for notes.

### What can I check in a reference without leaving Kanvaz?

Orbit 3D models in 13 render modes, play video and audio with frame stepping, scroll and zoom PDFs, see flattened PSD files, and sample real pixel colors with the eyedropper. The list is in [Media previews](media-previews.html).

### How do I check values (black and white) on a reference?

Select an image card and open Properties. Brightness, Contrast and Saturation sliders are non-destructive and work on image, GIF and video cards, so dropping Saturation to the bottom gives you a value check without changing the original.

### Can I draw on my references?

Yes. Annotate any card with pen, highlighter, line, arrow, rectangle, ellipse, text, pixel measure and an eyedropper. For board-wide sketching use the Scratch Board view. See [Scratch Board](scratch-board.html).

### How do I keep a big board organized?

Use tags (with autocomplete), Smart Folders (saved searches that update themselves), the Layers panel (hide, lock, reorder, star), grouping, and Tidy Up, Align and Distribute in Properties. The [Cookbook](cookbook.html) has a full recipe.

### Can I link references together?

Yes, with seven typed relationships (Related To, Inspired By, Derived From, Alternative To, Supports, Used In, References). Open Map View with `M` to see them as a graph. See [Map View](map-view.html).

### Can I use the same reference on several boards?

Yes, with shared cards. Edit the card on any board and the change shows up on the others. See [Shared Cards](shared-cards.html).

## Beside your other apps

### Does it stay on top of ZBrush, Blender or Photoshop?

Yes. Always on top is on by default and re-raises itself after other windows take the top spot. Details and limits, including games in exclusive full screen, are in [Always on top, Top Mode and MoodLock](working-with-other-apps.html).

### Can I just see the picture and nothing else?

Yes, that is MoodLock (`Ctrl+Shift+L`, or the lock next to Minimize). It hides every toolbar and panel, keeps Kanvaz on top and makes the board read-only. Left and Right flip through your references.

### Can I show a board to a client?

Use Presentation Mode from the Command Palette. It hides the toolbar and side panel, makes the board read-only and steps through the cards with the arrow keys.

### Does it work with several monitors?

Yes. Kanvaz is a normal window you can place on any monitor. MoodLock remembers where you parked the small window, and ignores a remembered spot on a monitor that is no longer connected.

## Customizing

### Can I change the keyboard shortcuts?

Not yet. The full list is in [Keyboard shortcuts](shortcuts.html) and in the app (press `?`).

### Is there a dark theme?

Yes, and a light one. Press `L` to switch, or use Settings. The change applies immediately.

### Which languages does it support?

The interface is in English only for now.

### Is there a screen reader mode?

Kanvaz has not been tested with screen readers and does not claim accessibility support. Keyboard shortcuts cover most actions and the Command Palette (`Ctrl+K`) can run any command from the keyboard. If something blocks you, please open an issue and say what you use.

### Can I use a pen tablet?

Tablets that drive the mouse pointer work like a mouse. Pressure sensitivity is not used.

### Can several people share one install?

Yes, with profiles. Each profile has its own settings, recent boards and recovery data, and there is a guest profile. See [Profiles](profiles.html).

## Plugins and AI

### Are plugins safe?

A plugin does nothing until you approve the permissions it asks for, and you are asked again if its files change. Once approved, a plugin is trusted like a browser extension and is not sandboxed, so install only plugins from developers you trust. See [Plugins](plugins.html).

### Can an AI assistant use my board?

With the MCP Bridge plugin, an AI client on your own machine can read and edit the open board over a local pipe. It never opens a network port and every change can be undone. The AI Export plugin makes a JSON and Markdown copy of a board for any AI tool without a live connection. See [MCP Bridge](mcp-bridge.html).

## Performance

### A big board feels slow. What can I do?

Lower Preview Quality in Settings, hide cards you are not using in the Layers panel, and split very large boards into several boards in one file. More in [System requirements and performance](requirements-and-performance.html).

## Still not answered?

Search the guide with `/`, check [Troubleshooting](troubleshooting.html), or write to me through [Contact and support](contact.html).
