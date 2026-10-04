# Session handoff, 2026-10-04

*For a fresh agent picking Kanvaz up cold. Read this first, then `docs/HANDOFF.md` for older architecture detail (its "Current state" banner is superseded by this file).*

## Where things stand (verified, not remembered)

- **UPDATE, later 2026-10-04: v9.8.0 is published** (`draft:false`, Latest; tag run `37221475137`, all six jobs green, 18 assets). It contains everything this file calls "unreleased" below (overwrite guard, `verify-release` job, catalog refresh, `RELEASING.md`, Presentation Mode order, live guide). The new `verify-release` job ran on GitHub for the first time on this tag and passed, so the draft-download assumption held. `latest.yml` serves 9.8.0, so installed copies will be offered the update. The plugin catalog needed no change (plugin zips unchanged; `verify-release` printed no catalog warnings). Where the text below says v9.7.0 is the latest or `main` is ahead, read it as superseded by this line.
- **README GIF:** a new ~14 s walkthrough (dark to light, Home to canvas, Map, Layers, Palette) is recorded at `F:\OBL\PLANS\gif-review\` (mp4, 22 MB gif, 12 MB lite gif, re-record scripts). It has NOT been pushed and is waiting for the owner's review before replacing `assets/gif-card-creation-v9.6.0.gif`.
- **Unverified oddity:** on a fresh profile the startup Home screen greeted the OS username after the profile had been renamed (the name had persisted). Not investigated.

- **v9.7.0 is live** (published 2026-09-30, `draft:false`, Latest). Assets: Windows installer + portable, macOS dmg for **both** arm64 (`Kanvaz-9.7.0-arm64.dmg`) and Intel (`Kanvaz-9.7.0.dmg`, no `-x64` suffix), Linux AppImage, per-platform `SHA256SUMS-*.txt`, official plugin zips (now including AI Export). `main` is **3 commits past the tag** (docs/guide/Pages/README/Presentation Mode/landing page work), all pushed, all under `CHANGELOG.md` `[Unreleased]`. No release is pending; nothing is stuck locally.
- `npm run lint` = 0 errors (5 old warnings: two stale "3.7.5" strings in app.js/boards.js, three hardcoded colors in theme-creator). `npm run validate` = ALL CHECKS PASSED.
- **GitHub Pages is live** at `https://p4inz-code.github.io/kanvaz/` (source: `main` / `/docs`, legacy Jekyll, `jekyll-theme-minimal`). Guide at `/guide/`. The CDN caches for minutes after a rebuild: when verifying a push, add a `?v=<commit>` query string or you will read stale HTML.
- Untracked, **never commit**: `upi-qr.jpeg`, `download.jpe`, `docs/handoff-assets/donate-rollout/`.

## What this session did (in order)

1. **AI Export plugin** (`official-plugins/ai-export/`): exports current board or all boards as a JSON + Markdown pair for AI agents, including each card's tags, properties and merged notes (Note-card text + Annotate text labels, source-tagged). Metadata-only for media. Built from the audited plan `docs/AI_EXPORT_AND_MAP_NOTES_PLAN.md`. Added `getTasks()` and `exportAIData()` to `src/plugin-api.js`, `ai-export-save-file` IPC to `main.js`/`preload.js`. Hardened `.md` sibling-file collision (never overwrites an unseen file).
2. **Core bug found by that plugin:** `KanvazBoards.switchBoard()` deferred its work via `setTimeout(...,20)` but returned `undefined`, so callers could not wait for it. Now returns a real Promise; `switchBoardById` chains onto it; Task Tracker `jumpToCard` fixed. A static regression guard is now `validate.js` section 9e (boards.js is DOM-coupled so no functional harness exists).
3. **Home Screen min/max/close buttons** (the real titlebar is hidden under the overlay). Wired at creation time in `boards.js`, icon state synced via `KanvazBridge.isMaximized()`, hidden on macOS via `.platform-mac` CSS.
4. **macOS polish:** dual-arch dmg (`mac.target` arch list), Home Screen logo clearance for traffic lights.
5. **Release audit by downloading real assets.** Found and fixed: bare "9.6.0" release title (CI now derives the title from the CHANGELOG heading and fails if it cannot parse one), wrong filenames in `.github/release-download-guide.md` (Windows uses dashes, Intel dmg has no `-x64`), and SHA256SUMS recording space-named files that never matched the dash-named uploads (workflow now renames before hashing). Verified with a real `sha256sum -c`.
6. **Strata / custom-build planning (historical):** a plan was written (`docs/STUDIO_TIER_PLAN.md`). **The owner dropped Strata from consideration on 2026-10-04** (it is nearly done elsewhere): do not raise it, ask about it, or treat its questions as open.
7. **Guide went live** (Pages enabled, front matter added to all 18 pages, `docs/_config.yml`), README trimmed 406 → ~285 lines (detail moved to `docs/guide/features.md`, `workflows.md`, `file-formats.md`, `known-limitations.md`, existing `shortcuts.md`), "How Kanvaz compares" table added (PureRef / Refern / Miro, sourced from `docs/ROADMAP.md` research).
8. **Presentation Mode** now steps in reading order (rows by y with 80px tolerance, then x). Verified live over CDP with scrambled-creation-order cards.
9. **Landing page (`docs/index.html`) corrections** the user caught on the live site: button said "Download v3.7.2" (now version-agnostic, link was already `releases/latest`), Top Mode card said "Press Tab" (real shortcut Ctrl+Shift+T), PureRef shown as paid and annotation-less (it is free and has drawing tools since 2.0), stats strip said 16 modules / 35+ releases (real: 53 `src/*.js`, 72 releases). Refern added as a column; `—` marks cells not independently verified.
10. All 18 guide pages said "Verified against v9.6.0" → bumped to v9.7.0; AI Export added to `guide/plugins.md`.

## Verified facts that corrected earlier guesses (do not re-derive)

- Autosave (30 s, recovery file only) and crash-log capture already exist and are tested. Plugin permission scoping is real and enforced (`test/plugin-scope-test.js`, validate section 8). Do not list these as gaps.
- Layers panel toggle shortcut **exists** (Shift+L, `shortcuts.js:209`). Older memory notes saying it does not are stale.
- Map View "dangling curve": a real stuck-wire bug (clicking the node a wire-drag started from) is already fixed at `map-view.js:423-437`. Whether it was the *same* bug seen during demo screenshots was never live-confirmed.
- Tag-chip / video-control resize items from the old v4.7 ROADMAP: the scrub-time/mute collapse is already animated (`main.css` ~3310). Treat the v4.7 list as historical.
- `docs/index.html` and `README.md` stats must be recounted, never copied from an older page.

## Hard limits found (not bugs)

- Native OS dialogs (plugin consent `showMessageBox`, open/save pickers) cannot be driven from CDP. That is deliberate security design. Workaround used for plugin testing: a standalone Node script that requires `src/plugin-loader.js` and calls `approvePlugin()` with a freshly scanned `contentHash`.
- `boardGrants` (main-process Set of dialog-approved paths) gates `file-read`/`file-write`. Unreachable from outside. Cannot test "Open Board" end to end without a human.
- Drag-drop import needs Electron's native `File.path`, which a synthetic `DragEvent` cannot produce.
- Live-test method: `npx electron . --remote-debugging-port=9333 --user-data-dir=<scratch under %TEMP%>`, then `node docs/handoff-assets/cdp/run.js <script-file>` (the script must be a real file; stdin does not work on this Windows/Git Bash setup). Cards created via `KanvazCards.createCardFromSerialized({type:'note',text:'X',w:200,h:150}, x, y)` need explicit `w`/`h` or `zoomFit` produces NaN. Presentation API is on `KanvazApp`, not `KanvazUI`. Kill with `taskkill //F //IM electron.exe //T` and delete the scratch profile afterwards.

## Open items, in priority order

2. ~~Shared-drive silent overwrite~~ **Done (later same day, unreleased on `main`).** `src/save-guard.js` + `file-read`/`file-write` mtime check + Overwrite / Save as copy / Cancel dialog; plugin `saveBoardToPath` returns `{conflict:true}` with no dialog. Verified live over CDP; the native Save-as-copy dialog and a real NAS were not. See CHANGELOG `[Unreleased]`.
3. ~~CI-gated release-asset verification~~ **Done (unreleased).** `verify-release` job + `tools/verify-release.js`, unit-tested and run against the real v9.7.0 assets. The job has NOT run on GitHub yet: the first tag push is its first real run (assumption: `gh release download` can fetch a draft with the Actions token; fallback commands are in `docs/RELEASING.md`).
4. ~~Bus-factor doc~~ **Done:** `docs/RELEASING.md`, including a second-maintainer onboarding command. Resolved with it: dead `ship.bat` and `test/version-check.js` deleted and the three never-commit paths gitignored; `official-plugins/catalog.json` brought current (all four plugins at the v9.7.0 zips, AI Export now listed) and the tag run now warns when it drifts again. Still true: the owner is the only collaborator, so a second person needs the invite command in `docs/RELEASING.md` run first; there are no Actions secrets to hand over.
4b. Still open from the old item 4: README GIF, optional smoke test of the real 9.7.0 installer, the unverified Layers right-click Rename commit/focus finding (needs a human).
4c. **CI note:** `main` went red on 2026-10-04 (run 37202960277) from a newly published `npm audit` advisory on `http-cache-semantics` (build tooling only); fixed by a lockfile bump to 4.3.0 (`a67d020`). The blocking audit gate can do this again with no code change.
5. README GIF: owner requirements are 10 s minimum, continuous motion (no 2-second freezes), must make a viewer want to download it. **Never push any image/GIF before the owner has reviewed it.** Deferred to last by explicit instruction.
6. Existing product backlog: per-stroke annotation select/move/delete, first-run "Set up your profile" screen + picker, font preview, custom property field types, MKV/AVI codec limits.

## Open decisions (owner's, not agent's)

None open. (Strata and custom builds were dropped from consideration on 2026-10-04.)

- Code signing is **explicitly excluded** from consideration (owner decision). Do not propose it again.
- After this stretch the owner said they will only fix bugs and take demanded features. Prefer small verified fixes over new surface area.

## Working rules the owner has set (carry over)

- "Ship" means GitHub release `draft:false` and Latest, verified with `gh release view`. Never `gh release create` before CI's build draft exists (it silently drops installers). Never say shipped on a push alone.
- Run `npm run lint` and `npm run validate` before any push. Update `CHANGELOG.md` with every change; bump the version in `package.json`, `src/boards.js` `VERSION`, README build filenames (validate checks all three) on a release.
- Verify UI changes live with real screenshots/CDP, say exactly what was and was not checked. Do not claim done from static checks.
- Check a claimed gap against the real code before stating it (this session wrongly listed crash logs and plugin permission enforcement as missing until grep proved otherwise).
- When told "plan only", write nothing executable. When told the owner is leaving the PC, ask every question in one batch first, then work unattended.
- Code style: ES5 `var`-only in `src/` (no `let/const/arrow/.forEach`); `test/lint.js` enforces it.
- Branding: "Atharva Patil | P4inz | Northbyte Studios"; plugin author fields stay plain "Northbyte Studios"; appId and plugin ids unchanged.
- Windows shell: use Git Bash for POSIX scripts; PowerShell has no `&&`.
- Do not commit the three untracked donate/QR files.
