# Kanvaz v4.0 — The Quality Release

**Target:** September 2026
**Codename:** "Nobody will hate this"
**Philosophy:** Zero new features. Fix every known bug, polish every card type to commercial grade, add the infrastructure that makes Kanvaz feel like a real product.

---

## PHASE 1 — Bug Fixes (v3.8.1 hotfix)

Ship these immediately before any polish work begins. All are verified with line-number proof.

### BUG 1 — Annotate shortcut opens on color cards

| | |
|---|---|
| **File** | `shortcuts.js` line 189 |
| **Root cause** | Guard checks `note` and `audio` but not `color` |
| **Fix** | Add `&& selCard.type !== 'color'` to the condition |

```js
// LINE 189 — change:
if (selCard && selCard.type !== 'note' && selCard.type !== 'audio') {
// to:
if (selCard && selCard.type !== 'note' && selCard.type !== 'audio' && selCard.type !== 'color') {
```

**Effort:** 30 seconds. One line.

---

### BUG 2 — Color picker leaks DOM elements

| | |
|---|---|
| **File** | `cards.js` lines 693–722 |
| **Root cause** | `<input type="color">` appended to body, only removed on `change` event. If user cancels (Escape/click away), picker stays in DOM forever. |
| **Fix** | Remove any existing picker before creating a new one. Add a `blur` listener as fallback cleanup. |

```js
// Before creating new picker, clean up any orphan:
var old = document.querySelector('input[type="color"][data-kanvaz-picker]');
if (old) old.parentNode.removeChild(old);

// Mark the new picker:
picker.dataset.kanvazPicker = '1';

// Add blur fallback (fires when picker closes without change):
picker.addEventListener('blur', function() {
  setTimeout(function() {
    if (picker.parentNode) picker.parentNode.removeChild(picker);
  }, 200);
});
```

**Effort:** 5 minutes. Add data attribute + cleanup + blur handler.

---

### BUG 3 — No `.kanvaz` file association

| | |
|---|---|
| **File** | `package.json` → `build` section |
| **Root cause** | No `fileAssociations` key in build config |
| **Fix** | Add file association block |

```json
"fileAssociations": [
  {
    "ext": "kanvaz",
    "name": "Kanvaz Board",
    "description": "Kanvaz Reference Board",
    "mimeType": "application/x-kanvaz",
    "role": "Editor",
    "icon": "assets/icons/icon"
  }
]
```

Place inside the `build` object, after `files`. The `icon` field auto-resolves `.ico`/`.icns`/`.png` per platform.

**Effort:** 2 minutes. JSON block.

---

### BUG 4 — No single-instance lock

| | |
|---|---|
| **File** | `main.js` — top of file, before `app.whenReady()` |
| **Root cause** | No `requestSingleInstanceLock()` call anywhere |
| **Fix** | Add lock + second-instance handler |

```js
var gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function(event, argv) {
    // Focus existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // If launched with a file arg, open it (ties into BUG 5)
    var filePath = argv.find(function(a) { return a.endsWith('.kanvaz'); });
    if (filePath && mainWindow) {
      mainWindow.webContents.send('open-file-from-argv', filePath);
    }
  });
}
```

**Effort:** 10 minutes. Must test that second launch focuses first window.

---

### BUG 5 — No `process.argv` / file-open handling

| | |
|---|---|
| **File** | `main.js` — inside `createWindow()` after window is ready |
| **Root cause** | No argv parsing, no `open-file` event (macOS) |
| **Fix** | Parse argv on startup + handle macOS `open-file` event |

```js
// Inside app.whenReady callback, after createWindow():
var fileArg = process.argv.find(function(a) { return a.endsWith('.kanvaz'); });
if (fileArg) {
  mainWindow.webContents.once('did-finish-load', function() {
    mainWindow.webContents.send('open-file-from-argv', fileArg);
  });
}

// macOS: open-file fires before ready sometimes
var pendingFile = null;
app.on('open-file', function(event, filePath) {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('open-file-from-argv', filePath);
  } else {
    pendingFile = filePath;
  }
});
```

Also requires:
- Adding `'open-file-from-argv'` to preload.js allowed channels
- Adding renderer-side handler in `boards.js` to receive and load the file

**Effort:** 30 minutes. Touches 3 files (main.js, preload.js, boards.js).

---

### BUG 6 — Window title never updates

| | |
|---|---|
| **File** | `main.js` — new IPC handler |
| **Root cause** | Title hardcoded to `'Kanvaz'`, no update mechanism |
| **Fix** | Add IPC handler + call from renderer on save/open |

```js
// main.js — in registerIPC():
ipcMain.on('set-window-title', function(event, title) {
  if (mainWindow) mainWindow.setTitle(title);
});

// preload.js — add to contextBridge:
setWindowTitle: function(title) { ipcRenderer.send('set-window-title', title); }

// boards.js — call after save/open:
KanvazBridge.setWindowTitle('Kanvaz — ' + filename + (dirty ? ' *' : ''));
```

**Effort:** 15 minutes. Touches 3 files (main.js, preload.js, boards.js).

---

### BUG 7 — Context menu shows irrelevant items for color/audio

| | |
|---|---|
| **File** | `app.js` lines 641, 663–668 |
| **Root cause** | Flip/reset guard only excludes `note`. Clear annotations has no guard at all. |
| **Fix** | Tighten both guards |

```js
// LINE 641 — change:
if (card.type !== 'note') {
// to:
if (card.type !== 'note' && card.type !== 'color' && card.type !== 'audio') {

// LINE 663 — wrap clear annotations with guard:
if (card.type !== 'note' && card.type !== 'audio' && card.type !== 'color') {
  items.push({
    label: 'Clear annotations',
    action: function() {
      if (typeof KanvazAnnotate !== 'undefined') KanvazAnnotate.clearAnnotations(card.id);
    }
  });
}
```

**Effort:** 2 minutes. Two guard changes.

---

### BUG 8 — `flipCard()` corrupts state on non-visual cards

| | |
|---|---|
| **File** | `cards.js` lines 1182–1198 |
| **Root cause** | Toggles flipH/flipV flags regardless of card type, even when no img/video exists |
| **Fix** | Early return for non-visual types |

```js
function flipCard(id, axis) {
  var card = cards[id];
  if (!card) return;
  // Only flip visual media cards
  if (card.type === 'note' || card.type === 'color' || card.type === 'audio') return;
  // ... rest unchanged
}
```

**Effort:** 1 minute. One guard line.

---

### Bug Fix Summary

| # | Severity | Effort | Files touched |
|---|----------|--------|---------------|
| 1 | Medium | 30 sec | shortcuts.js |
| 2 | Low | 5 min | cards.js |
| 3 | High | 2 min | package.json |
| 4 | Critical | 10 min | main.js |
| 5 | High | 30 min | main.js, preload.js, boards.js |
| 6 | Medium | 15 min | main.js, preload.js, boards.js |
| 7 | Medium | 2 min | app.js |
| 8 | Low | 1 min | cards.js |

**Total estimated fix time: ~1 hour**

---

## PHASE 2 — Card UI/UX Polish

Goal: Every card type should feel like it belongs in a $50/yr commercial tool. Maximum minimalism, maximum usability. No card should feel like an afterthought.

### 2A. IMAGE CARD — Current & Proposed

**Current state:** Bare `<img>` with `object-fit:cover`. Card bar shows filename on hover. No loading state, no broken-image recovery beyond a text fallback.

**Polish plan:**

| Area | Current | Proposed |
|------|---------|----------|
| Loading state | None — blank until loaded | Subtle skeleton shimmer (CSS animation on `::before` pseudo) that fades out on `img.onload` |
| Error state | Plain "Missing media" text div | Themed error card with broken-image icon (SVG), filename shown, and "Relink" button in card bar |
| Aspect ratio | `object-fit:cover` crops aggressively | Add right-click option to toggle `cover` ↔ `contain`. Save as `card.objectFit`. Default stays `cover` |
| Card bar | Shows raw filename only | Truncate with ellipsis (already done), add image dimensions badge like `1920×1080` — pulled from `img.naturalWidth/Height` |
| Annotation overlay | Works but no visual indicator | Add a small pencil dot icon in top-left when card has annotations (persistent, not just on hover) |
| Selection ring | 4px accent ring | Keep as-is — already polished |

**Files:** `cards.js` (`buildImageCard`), `main.css` (add `.card-image .skeleton`, `.card-image .error-state`)

---

### 2B. GIF CARD — Current & Proposed

**Current state:** Same as image but with click-to-pause via swapping `img.src` to first-frame data URL. Badge says "GIF". Cursor is pointer on the img.

**Polish plan:**

| Area | Current | Proposed |
|------|---------|----------|
| Pause indicator | None — GIF just freezes | Overlay a semi-transparent pause icon (⏸) centered on the card when paused, fade out on resume |
| Pause UX | Click anywhere on image | Keep click-to-pause but also add a small ⏸/▶ toggle button in the card bar (consistent with video/audio) |
| Loading | None | Same skeleton shimmer as image card |
| Error state | None (img.onerror not set) | Same error card pattern as image |
| Card bar | Filename + GIF badge | Keep — already good |

**Files:** `cards.js` (`buildGifCard`, `toggleGifPause`), `main.css` (add `.gif-pause-overlay`)

---

### 2C. VIDEO CARD — Current & Proposed

**Current state:** Richest card type. Auto-plays muted+looped on load. Scrub bar with play/pause, seek track, time display, mute button. Container queries hide time/mute on small cards. Scrub bar only shows on hover.

**Polish plan:**

| Area | Current | Proposed |
|------|---------|----------|
| Scrub bar visibility | Hidden until hover | Add a thin 2px progress line at the bottom that's always visible (even without hover). Full scrub bar still shows on hover |
| Scrub thumb | No thumb on track | Add a 10px circle thumb at the fill position — appears on hover, draggable |
| Volume slider | Mute toggle only | Keep mute toggle (simple is better for a reference board). No volume slider — overengineering |
| Playback speed | None | Add 0.5×/1×/2× toggle via right-click context menu submenu |
| Loading state | Blank until `onloadeddata` | Same skeleton shimmer. Show a centered spinner on the video area until first frame renders |
| Error state | "Video format not supported" text | Keep but style it with the same broken-media pattern as image |
| Card bar | Filename + VID badge | Add duration badge after VID badge: `0:42` |

**Files:** `cards.js` (`buildVideoCard`), `main.css` (`.video-progress-line`, `.scrub-thumb`), `app.js` (playback speed submenu)

---

### 2D. AUDIO CARD — Current & Proposed

**Current state:** Music note SVG icon area + scrub bar (always visible, not hidden on hover). Play/pause, seek, time, mute. No auto-play (good). Resets to play icon on ended.

**Polish plan:**

| Area | Current | Proposed |
|------|---------|----------|
| Icon area | Static music note SVG, accent stroke | Add subtle pulse animation on the SVG strokes while playing (CSS `@keyframes` on stroke-dashoffset). Stops when paused |
| Waveform | None | Generate a simple waveform visualization from the audio buffer — render as a static SVG behind the icon area (subtle, 15% opacity). This makes each audio card visually unique |
| Background | Flat `var(--color-surface)` | Add a subtle radial gradient from accent color (5% opacity) in the icon area — gives it depth without being loud |
| Duration | Shows in scrub time | Add duration to card bar badge: `AUDIO · 3:24` |
| Filename | Raw filename in card bar | Keep but ensure long filenames truncate well (already has ellipsis) |
| Loop toggle | Not available | Add loop toggle button in scrub bar (small loop icon, toggles `aud.loop`). Off by default |

**Files:** `cards.js` (`buildAudioCard`), `main.css` (`.audio-playing .audio-icon-svg`, waveform styles)

---

### 2E. NOTE CARD — Current & Proposed

**Current state:** Full-card `<textarea>` with placeholder "Type a note…". Background is `var(--color-surface)` with border. Saves on blur. 14px font, 1.6 line-height.

**Polish plan:**

| Area | Current | Proposed |
|------|---------|----------|
| Visual hierarchy | Flat surface, no visual structure | Add a subtle top-left colored accent bar (3px wide, 24px tall, accent color) — makes notes visually distinct from other cards at a glance |
| Character count | None | Show character count in card bar: `142 chars` — useful for copy-paste reference notes |
| Markdown preview | None | **Defer to v5.** Too complex for a polish release. Keep textarea-only |
| Auto-resize font | Fixed 14px | Keep fixed — consistency matters more than cleverness |
| Placeholder | "Type a note…" | Change to "Note" — shorter, cleaner |
| Line numbers | None | **No.** This isn't a code editor. Clean textarea is the right call |
| Card bar | Filename (shows "note") + NOTE badge | Show first ~20 chars of note text as the filename instead of "note" |

**Files:** `cards.js` (`buildNoteCard`, `createNoteCard`, card bar name logic), `main.css` (`.note-accent-bar`)

---

### 2F. COLOR CARD — Current & Proposed

**Current state:** Swatch div (full card minus 48px for label + bar) + hex label (11px mono, user-select:all) + card bar with color dot badge. Click swatch opens native color picker. All styles inline.

**Polish plan:**

| Area | Current | Proposed |
|------|---------|----------|
| Inline styles | 100% inline on swatch + label | Move to CSS classes. Currently the only card type with zero CSS class rules (all inline). This is inconsistent and harder to theme |
| Hex label | Shows hex only | Show hex + copy button (small clipboard icon). Click copies hex to clipboard. Also add RGB display toggle on click: `#9D7FFF` ↔ `rgb(157, 127, 255)` ↔ `HSL(255, 100%, 75%)` |
| Swatch corners | `border-radius:6px 6px 0 0` inline | Move to CSS. Match card radius variable |
| Contrast checker | None | Show a small W/B text sample on the swatch (white "Aa" and black "Aa") so user can see contrast at a glance. Subtle, 30% opacity, bottom-right corner |
| Color picker leak | BUG 2 — orphaned inputs | Fixed in Phase 1 |
| Card bar | Filename shows hex, badge is color dot | Keep — already clean. The dot badge is a nice touch |
| Palette mode | Single color only | **Defer.** Multi-swatch palette cards are a v5 feature |

**Files:** `cards.js` (`buildColorCard`), `main.css` (add `.color-swatch`, `.color-label`, `.color-copy-btn`, `.color-contrast`)

---

### 2G. Cross-Card Polish (applies to all types)

| Area | Current | Proposed |
|------|---------|----------|
| Card bar height | Fixed 24px | Keep 24px — it's compact and consistent |
| Card bar background | `var(--color-surface)` | Add slight blur backdrop: `backdrop-filter: blur(8px); background: rgba(var(--color-surface-rgb), 0.85)` — makes bar float over content elegantly |
| Card border | 1px solid border on note only | Add `1px solid var(--color-border)` to ALL card types for visual consistency. Currently image/gif/video have no border, which looks inconsistent when cards are on a light canvas |
| Card shadow | `0 4px 16px rgba(0,0,0,0.25)` on hover | Add a resting shadow: `0 1px 4px rgba(0,0,0,0.15)` (already exists for light theme, missing for dark) |
| Resize handles | 8px accent dots on corners | Keep — polished. Maybe add edge handles (center of each side) for non-proportional resize. **Optional.** |
| Card entrance | None — cards appear instantly | Add subtle scale-in: `@keyframes card-in { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }` — 200ms ease-out |
| Pin indicator | Amber dot, top-right | Keep — good |
| Tag bar | Shows on hover, bottom of card | Keep positioning. Polish: add tag auto-complete dropdown using `collectAllTags()` |

---

## PHASE 3 — Infrastructure Polish

These aren't bugs but make Kanvaz feel like a commercial product.

| Feature | Files | Effort | Priority |
|---------|-------|--------|----------|
| **Auto-updater** | main.js, package.json (add `electron-updater` dep, add `publish` config pointing to GitHub releases) | 2 hours | High |
| **NSIS installer polish** | package.json (add `license`, `installerSidebar`, `publisherName` to nsis config) | 30 min | Medium |
| **GitHub Actions CI** | `.github/workflows/build.yml` (matrix: win/mac/linux, auto-upload to release) | 1 hour | High |
| **App reset v2** | main.js (current reset only clears settings/recent/recovery — should also offer to clear Cache/, GPUCache/, Local Storage/) | 20 min | Low |
| **Unsaved changes dot** | boards.js, ui.js (show `●` next to filename in titlebar when dirty) | 15 min | Medium |

---

## PHASE 4 — Release Checklist

### Version Bump (6 locations)
1. `package.json` → `"version": "4.0.0"`
2. `boards.js` → `VERSION = '4.0.0'`
3. `ui.js` → About section ×2
4. `README.md` → build output reference
5. `docs/generate_overview_pdf.py` → footer

### Pre-Ship
1. `npm run validate` (lint ×2, syntax ×2, Puppeteer port test ×2)
2. `git status` → verify no untracked secrets
3. `git add -A && git commit -m "v4.0.0"`
4. `git tag v4.0.0`
5. `git push origin main && git push origin v4.0.0`

### Build
- **Windows:** `npm run build:win` (local)
- **Mac + Linux:** GitHub Actions CI (requires `.github/workflows/build.yml`)

### Release
- GitHub Release with changelog
- Update landing page

---

## Timeline (September 2026)

| Week | Focus |
|------|-------|
| **Week 1** | Phase 1: Fix all 8 bugs → ship as v3.8.1 hotfix |
| **Week 2** | Phase 2A–2C: Image, GIF, Video card polish |
| **Week 3** | Phase 2D–2F: Audio, Note, Color card polish + 2G cross-card |
| **Week 4** | Phase 3: Infrastructure (auto-updater, CI, installer) + Phase 4: Ship v4.0.0 |

---

## What v4.0 is NOT

- No new card types (URL cards deferred)
- No new views
- No force-directed layout
- No code refactoring (that's v5.0)
- No WebGL (that's v5.1)

This is purely: fix what's broken, polish what exists, ship what's missing for a professional feel.
