# Kanvaz — Full Chat Continuation Summary

Copy everything below the `---` line and paste it as your first message in a new chat. Make sure the Kanvaz folder (`F:\OBL\Kanvaz`) is connected.

---

## CONTEXT — READ THIS FULLY BEFORE DOING ANYTHING

I'm Grim (P4inZ), solo dev building Kanvaz under Northbyte Studios. Kanvaz is a free offline Electron reference board app (infinite canvas moodboard + node-graph Map View). Repo: `F:\OBL\Kanvaz`. GitHub: `https://github.com/p4inz-code/kanvaz` (MIT, public).

### Tech Stack (LOCKED — never change these)
- Electron 22.3.27, electron-builder 24.13.3
- Vanilla ES5 JavaScript ONLY — `var` only, no `const`/`let`/arrow functions/`forEach` (enforced by custom linter)
- Vanilla CSS with custom properties + container queries
- IIFE module pattern for all source files
- Terminal: `cmd.exe` (not PowerShell) — use `cd /d` to switch drives
- Do NOT run `npm audit fix --force` — 6 high vulns are build-time only, intentionally tolerated

### Current Version: 3.8.0
- Committed and tagged as `v3.8.0`
- Tag `v3.8.0` pushed to remote successfully
- **Branch push FAILED** — remote had divergent commits. Need to run: `git pull --rebase origin main && git push origin main`
- Windows build exists in `dist/` from a prior session
- Mac/Linux builds require native OS or GitHub Actions CI (can't cross-compile)
- Working tree shows line-ending diffs on ALL files (CRLF↔LF) — these are NOT real code changes, just EOL normalization. Consider adding `.gitattributes` with `* text=auto` to fix permanently

### Version Locations (6 places, must bump atomically)
1. `package.json` → `"version"`
2. `src/boards.js` line 10 → `var VERSION = '3.8.0'`
3. `src/ui.js` line 697 → `Version 3.8.0`
4. `src/ui.js` line 705 → `v3.8.0`
5. `README.md` → build output reference
6. `docs/generate_overview_pdf.py` → footer

### Source Files (16 modules, loaded in this order in index.html)
errors → reference-types → media → canvas → cards → connections → history → annotate → boards → inspector → properties → map-view → shortcuts → ui → app

### Card Types: image, gif, video, audio, note, color

---

## 8 VERIFIED BUGS IN v3.8.0 — NOT YET FIXED

All verified with exact line numbers. Full fix plan is in `V4_PLAN.md` in the repo root.

### BUG 1 — Annotate shortcut opens on color cards
- **File:** `shortcuts.js` line 189
- **Issue:** Guard checks `note` and `audio` but missing `color`
- **Fix:** Add `&& selCard.type !== 'color'` to the if condition

### BUG 2 — Color picker leaks DOM elements
- **File:** `cards.js` lines 693–722
- **Issue:** `<input type="color">` appended to body on each swatch click. Only removed in `change` listener. If user cancels, element stays forever
- **Fix:** Clean up orphan before creating new one + add `blur` fallback cleanup

### BUG 3 — No `.kanvaz` file association
- **File:** `package.json` — `build` section
- **Issue:** No `fileAssociations` key. OS doesn't know `.kanvaz` files belong to Kanvaz
- **Fix:** Add `fileAssociations` array with ext, name, mimeType, icon

### BUG 4 — No single-instance lock (CRITICAL)
- **File:** `main.js` — missing entirely
- **Issue:** No `app.requestSingleInstanceLock()`. Multiple instances can corrupt save files
- **Fix:** Add lock + `second-instance` event handler that focuses existing window

### BUG 5 — No process.argv / file-open handling
- **File:** `main.js` — missing entirely
- **Issue:** No argv parsing, no macOS `open-file` event. Double-clicking a `.kanvaz` file does nothing
- **Fix:** Parse argv for `.kanvaz` files, send to renderer via IPC. Add `open-file-from-argv` channel to preload.js allowed channels. Add handler in boards.js

### BUG 6 — Window title never updates to filename
- **File:** `main.js` line 58 — title hardcoded `'Kanvaz'`
- **Issue:** No `setTitle()` calls anywhere. Taskbar always shows "Kanvaz"
- **Fix:** Add `set-window-title` IPC handler in main.js, expose in preload.js, call from boards.js on save/open

### BUG 7 — Context menu shows flip/reset/clear-annotations for color/audio cards
- **File:** `app.js` lines 641, 663–668
- **Issue:** Flip/reset guard only excludes `note` (should also exclude `color` and `audio`). "Clear annotations" has NO guard at all
- **Fix:** Add `&& card.type !== 'color' && card.type !== 'audio'` to both guards

### BUG 8 — flipCard() corrupts state on non-visual cards
- **File:** `cards.js` lines 1182–1198
- **Issue:** Toggles `flipH`/`flipV` flags regardless of card type, then queries `img, video` (returns null for color/audio). Flags serialize as garbage state
- **Fix:** Early return for `note`, `color`, `audio` card types

---

## V4.0 PLAN — FULL DETAILS IN `V4_PLAN.md`

The plan file is saved at repo root. It covers:

**Phase 1 — Bug fixes (~1 hour):** Fix all 8 bugs above, ship as v3.8.1 hotfix

**Phase 2 — Card UI/UX polish (all 6 types):**
- **Image:** Skeleton loading shimmer, themed error state with relink button, cover↔contain toggle, dimensions badge, annotation indicator dot
- **GIF:** Pause overlay icon, play/pause button in card bar, loading/error states
- **Video:** Always-visible 2px progress line, scrub thumb, playback speed submenu (0.5×/1×/2×), duration badge in card bar, loading spinner
- **Audio:** Pulse animation on icon while playing, waveform visualization behind icon, radial gradient background, duration in badge, loop toggle button
- **Note:** Colored accent bar (top-left), character count in card bar, show first ~20 chars as filename, shorter placeholder ("Note")
- **Color:** Move all inline styles to CSS classes, hex copy button + format toggle (hex↔rgb↔hsl), contrast checker (W/B text samples on swatch)
- **Cross-card:** Backdrop-blur card bar, consistent 1px border on all types, resting shadow for dark theme, scale-in entrance animation, tag auto-complete

**Phase 3 — Infrastructure:**
- Auto-updater via `electron-updater`
- NSIS installer polish (license, sidebar, publisherName)
- GitHub Actions CI for cross-platform builds
- App reset v2 (clear Electron caches)
- Unsaved changes dot in titlebar

**Phase 4 — Ship v4.0.0:** Version bump ×6, validate, commit, tag, push, build, release

**Timeline:** 4 weeks in September 2026

---

## WHAT TO DO NEXT

1. **Fix the git push:** `cd /d F:\OBL\Kanvaz && git pull --rebase origin main && git push origin main`
2. **Fix the line-ending issue:** Add `.gitattributes` with `* text=auto eol=lf`
3. **Fix all 8 bugs** — exact code changes are in `V4_PLAN.md`
4. **Ship v3.8.1** — version bump ×6, validate, commit, tag, push
5. **Start Phase 2** — card UI/UX polish per `V4_PLAN.md`

Start by reading `V4_PLAN.md` in the repo root — it has every fix with exact code diffs and line numbers. Then fix all 8 bugs in order: 1→7→8 (one-liners), then 2 (cleanup pattern), then 4→5→6 (infrastructure trio), then 3 (package.json).

---

## KEY FILE REFERENCE

| File | Lines | Purpose |
|------|-------|---------|
| `src/main.js` | ~445 | Electron main process — window, IPC, crash-safe save, recovery |
| `src/preload.js` | ~65 | Context bridge — allowed IPC channels |
| `src/app.js` | ~1125 | Context menus, search/filter, paste, PureRef import, Top Mode |
| `src/cards.js` | ~1370 | Card engine — event delegation, all 6 card builders, flip/resize/select |
| `src/boards.js` | ~700 | Board tabs, save/load, autosave, startup screen, VERSION constant |
| `src/shortcuts.js` | 227 | Keyboard dispatcher — all shortcuts |
| `src/ui.js` | ~700 | Minimap, settings, about, shortcuts overlay |
| `src/main.css` | ~1020 | Full design system — variables, layout, card styles, container queries |
| `src/map-view.js` | ~1500 | Node-graph view |
| `src/properties.js` | ~328 | Properties panel (key-value metadata) |
| `package.json` | 79 | Build config, deps, scripts |
| `V4_PLAN.md` | ~300 | Full v4.0 plan with all bug fixes and card polish specs |

## CODING RULES (PERMANENT)
- `var` only — no const/let/arrow/forEach
- No inline onclick (CSP violation)
- Hardcoded colors must use CSS variables
- Six version locations bumped atomically
- Run `npm run validate` before every commit
- Present plan before writing code ("plan mode")
