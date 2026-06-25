# Kanvaz

**Your canvas. Your references.**

An infinite canvas for VFX artists, 3D artists, and the people who teach them.  
Drop images, GIFs, videos, and audio. Annotate. Save. No internet. No telemetry. Your files never leave your machine.

### [⬇ Download for Windows](https://github.com/p4inz-code/kanvaz/releases/latest)

Grab the latest installer from the [Releases page](https://github.com/p4inz-code/kanvaz/releases/latest) — no setup or technical knowledge needed.

> **Note:** Kanvaz isn't code-signed (signing certificates cost money and
> this app is free). When you run the installer, Windows will likely show
> a blue **"Windows protected your PC"** screen. This is normal for
> unsigned indie apps — click **"More info"** → **"Run anyway"**.
>
> Prebuilt downloads are Windows only. macOS and Linux users can build
> from source — see [Build installers](#build-installers) below.

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## Requirements

- Node.js 18+ ([nodejs.org](https://nodejs.org))
- npm 9+

---

## Run in development

```bash
npm install
npm start
```

---

## Build installers

**Windows (installer + portable):**
```bash
npm run build:win
```
Output: `dist/Kanvaz Setup 3.0.0.exe` and `dist/Kanvaz 3.0.0.exe`

**macOS:**
```bash
npm run build:mac
```

**Linux:**
```bash
npm run build:linux
```

**All platforms:**
```bash
npm run build:all
```

---

## Distributing to a friend

Send them the **portable `.exe`** from `/dist/`. No install needed — just run it.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Scroll | Zoom in / out |
| Ctrl+Scroll | Fine zoom |
| Middle mouse / Space+drag | Pan |
| 0 | Reset zoom |
| F | Fit all cards |
| T | Always on top |
| Ctrl+S | Save board |
| Ctrl+Shift+S | Save board as new file |
| Ctrl+O | Open board |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+A | Select all cards |
| Delete | Delete selected card |
| Ctrl+D | Duplicate card |
| P | Pin / unpin card |
| A | Annotate selected card |
| C | Connections inspector |
| M | Toggle Board / Map view |
| H | Hide annotations |
| Arrow keys | Nudge card 1px |
| Shift+Arrow | Nudge card 10px |
| Ctrl+Shift+F | Mood lock (fullscreen canvas) |
| ? | Shortcuts overlay |
| Esc | Deselect / close panels |

---

## File format

Boards are saved as `.kanvaz` files — plain JSON. Media is embedded as base64 data URLs. Self-contained, portable, no external references.

---

## Known limitations

These are stable, by-design limitations — not bugs, and not currently planned:

- No light/dark theme toggle (dark theme only).
- No "Tags" feature.
- The "open on startup" setting currently has no effect.
- `.kanvaz` files embed media as base64, so files with a lot of video/audio can get large.
- The annotation toolbar doesn't follow the canvas if you pan/zoom while it's open.

---

## Documentation

- [Technical Overview](docs/TECHNICAL_OVERVIEW.md) — architecture, module map, build conventions
- [Privacy](PRIVACY.md) — what Kanvaz does (and doesn't) do with your data
- [Third-Party Notices](THIRD_PARTY_NOTICES.md) — licensing for Electron and other bundled components
- [Changelog](CHANGELOG.md) — version history

---

## License

MIT — free forever.  
Made by **Atharva Patil** — Northbyte Studios, Navi Mumbai, India.
