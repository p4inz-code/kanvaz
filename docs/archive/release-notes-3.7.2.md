## Kanvaz v3.7.2 — Polish: Map View UX, tab badges, Top Mode drag bar

A quality-of-life update that makes Map View more usable, adds visual feedback across the UI, and introduces a one-click ship script for development.

### What's new

**Top Mode visible drag bar** — When Top Mode is active (Tab or Ctrl+Shift+F), a subtle accent-colored strip now appears at the very top of the screen so you can see exactly where to grab to move the window. The bar brightens on hover for clear feedback. Previously the drag zone was completely invisible.

**Map View zoom-to-fit (F key)** — Press F in Map View to instantly fit all nodes into the viewport, matching the same shortcut's behavior in Board View. Useful when you've panned/zoomed away from your nodes and need to re-orient.

**Double-click-to-jump** — Double-click any node in Map View to close the map and jump straight to that card on the board, selected and centered in the viewport.

**Card count badges** — Board tabs now display a small count badge showing how many cards are in each board, so you can see board density at a glance without switching.

**Resize handle cursor** — Card resize handles now show the `nwse-resize` cursor on hover, giving clear visual feedback that the corner is draggable.

**`npm run dist` alias** — Shortcut for `npm run build:win` so `npm run dist` works out of the box.

**`ship.bat` automation** — One-click ship script for contributors: cleans stale git locks → lint → syntax check → version consistency check (all 6 locked locations) → git add/commit/tag/push → build installers. Catches errors at each step with clean abort.

### Download

| File | Description |
|------|-------------|
| `Kanvaz Setup 3.7.2.exe` | Installer (recommended) |
| `Kanvaz 3.7.2.exe` | Portable — no install needed |

> **Note:** Kanvaz isn't code-signed. Windows will show a "Windows protected your PC" prompt — click **More info → Run anyway**.

### Full changelog

https://github.com/p4inz-code/kanvaz/blob/main/CHANGELOG.md
