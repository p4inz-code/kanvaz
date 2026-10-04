# Session handoff, 2026-10-04

*For a fresh agent picking Kanvaz up cold. Read this first, then `docs/HANDOFF.md` for older architecture detail (its "Current state" banner is superseded by this file).*

## Where things stand (verified, not remembered)

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
6. **Planning only (no code):** Strata paid hierarchy/node app + custom-build services. Plan at `docs/STUDIO_TIER_PLAN.md` and a portable copy at `F:\OBL\PLANS\strata-studio-tier\` (PLAN.md + README.md). A scaffold was started then deliberately deleted on instruction ("do not start execution, only plan it"). See "Open decisions".
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

1. **Decide whether `docs/STUDIO_TIER_PLAN.md` stays public.** It was committed and pushed in `efe2a83` without flagging. It contains pricing targets ($25, ceiling $40) and custom-build/hosting liability discussion. `docs/ROADMAP.md` already publishes monetization plans, so it may be fine, but it was the owner's call and was not asked. The portable copy in `F:\OBL\PLANS\` is the canonical one.
2. **Shared-drive silent overwrite** (confirmed gap): `boards.js` reads file `mtime` only for the "3 hours ago" label, never compares it at save time, so two people saving one `.kanvaz` from a NAS clobber each other with no warning. Small fix: compare mtime-at-load vs mtime-at-save, warn on change.
3. **CI-gated release-asset verification**: after upload, download the draft's assets, `sha256sum -c`, and diff asset names against `release-download-guide.md`, failing before anyone clicks publish. This is the class of bug that hit two releases.
4. Bus-factor doc (a second person able to cut a release), README GIF, optional smoke test of the real downloaded 9.7.0 installer, and the unverified Layers right-click Rename commit/focus finding (needs a human).
5. README GIF: owner requirements are 10 s minimum, continuous motion (no 2-second freezes), must make a viewer want to download it. **Never push any image/GIF before the owner has reviewed it.** Deferred to last by explicit instruction.
6. Existing product backlog: per-stroke annotation select/move/delete, first-run "Set up your profile" screen + picker, font preview, custom property field types, MKV/AVI codec limits.

## Open decisions (owner's, not agent's)

- **Strata** (working name, not confirmed): separate paid app, one-time $19–40 (target ~$25, hard ceiling $40), v1 = deep hierarchy + built-in local MCP server (the differentiator vs Kanvaz's free static AI Export). No hosting, no recurring cost. Unanswered: product name, v1 scope confirmation, whether v1 imports `.kanvaz`, anti-piracy stance, seat policy. Reuse `official-plugins/mcp-bridge/` (stdio shim + local socket + token file) and the hardened Kanvaz `build.yml`.
- **Custom builds for hire** (separate services business): start with self-delivered white-label/feature builds; do **not** take a hosted/cloud engagement before a scope-of-work template and a basic services contract exist. Hosting a studio's confidential references is a liability jump from Kanvaz's offline model.
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
