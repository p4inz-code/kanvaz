# Session handoff: 2026-09-20 to 2026-09-21

*Written so a fresh Claude session can rebuild full context from this one file. Read it first, then `docs/HANDOFF.md` (older history), `docs/ROADMAP.md` (the "Security & platform hardening" section is current), and `F:\OBL\KanvazLink\docs\` for the Kanvaz Link project.*

Owner: Atharva Patil | P4inz | Northbyte Studios (GitHub `p4inz-code`, Windows 11, repo `F:\OBL\Kanvaz`, Blender 5.2.1 LTS installed at `F:\Blender`).

---

## 1. How the owner likes to work (standing rules)

- **"I'm offline" gates live testing.** Never launch Kanvaz or Electron until the owner says so. Only kill the process whose command line has `remote-debugging-port=9333`; never a broad `taskkill /IM electron.exe`.
- **No commit, push, tag or publish in the Kanvaz repo until the owner says.** "Shipped" means a real published GitHub Release (`draft:false`). Never run `gh release create` before CI's draft exists (it drops every installer; this caused 8 broken releases once).
- **Do not claim "done" without live verification.** Say exactly what was and was not checked.
- **Update CHANGELOG / HANDOFF / SECURITY on every release**, no exceptions.
- **Ask instead of assuming** on ambiguous design, but in auto mode make sensible reversible calls and keep going. "Keep going, do not stop" is the usual instruction.
- **Design taste:** purple theme, minimal, human-made looking, not "AI generic" (no glassy gradients, glow, confetti). A donation page must read as a donation, not a purchase or subscription. Do not remove previous content when polishing; add only a few things.
- **Brand line:** "Atharva Patil | P4inz | Northbyte Studios". Plugin author fields stay plain "Northbyte Studios".
- **Code style:** ES5 `var`-only in `src/`, no new dependencies unless needed, comments only where the why is non-obvious.
- **Tooling lessons:** write patch scripts with the Write tool, not bash heredocs (heredocs mangle backslashes and once wrote raw NUL bytes into `plugin-loader.js`). Scan for NUL bytes after big patch sessions.
- **Memory files** live in `C:\Users\Admin\.claude\projects\F--OBL-Kanvaz\memory\` (index `MEMORY.md`).

---

## 2. What happened in this session (chronological)

### Window A: live-audit card bugs and features (before the security work)
Fixed or implemented (all later live-verified): 3D render-mode bar moved to a strip below the card (hover) plus a right-click "3D View" picker; click outside a card leaves edit mode; `S` shortcut works after window refocus; Map View stuck dashed wire (same node, same port); video frame-step and onion skin moved into the Properties panel; text file cards; audio waveform/icon fixes; Blender detection root cause (a 14-path hardcoded list missed `F:\Blender`); URL card test artifacts explained.

### Window B: security audit reconciliation
Two external reports (DeepSeek and another agent) were checked claim by claim; the table is in `docs/ROADMAP.md`. Real problems found and fixed, plus several found by our own testing (undo field wipe, NUL bytes, plugin hash cap).

### Window C: the Kanvaz hardening pass (unreleased, uncommitted)
Electron 22.3.27 -> **44.4.3** (Chromium 152), electron-builder 24 -> **26.15.3**, `npm audit` 13 findings -> **0**. New trust-boundary modules with Node-only tests: `src/path-guard.js`, `src/net-guard.js`, `src/mcp-auth.js`, `src/crash-log.js`, `src/blender-detect.js`, zip limits in `src/board-container.js`. Plugin approval now bound to a SHA-256 of the whole plugin folder. Live-verified on Electron 22, Electron 44 dev run, and a packaged Windows build.

### Window D: donation section and profile work (not part of the product plan)
Direct UPI donation block added to READMEs, a `donate` repo with a GitHub Pages page, profile README rebuilt. Details in section 6.

### Window E: Kanvaz Link (new commercial product)
Owner supplied a 94-section Master Product Specification for a paid Blender -> Kanvaz add-on. Planning and research done, feasibility document written, no product code. Details in section 5.

---

## 3. Kanvaz repo: exact state

- Version in `package.json`: **8.9.8** (unreleased work sits on top). Latest published GitHub release is **v8.8.5** per `gh release list`.
- Local `main` is **8 commits behind `origin/main`** and 0 ahead. The 8 are README edits made through the GitHub API (donation block, badges, install note, views badge add and removal). Run `git pull` before any push. Untracked `upi-qr.jpeg` and `download.jpe` in the root do not conflict.
- **30 modified files plus new ones, all uncommitted.** Untracked new: `src/blender-detect.js`, `src/crash-log.js`, `src/mcp-auth.js`, `src/net-guard.js`, `src/path-guard.js`, `test/blender-detect-test.js`, `test/board-container-limits-test.js`, `test/crash-log-test.js`, `test/mcp-auth-test.js`, `test/net-guard-test.js`, `test/path-guard-test.js`, `docs/archive/`, `docs/handoff-assets/`, `docs/SESSION_HANDOFF_2026-09-21.md`. Deleted from root (moved to `docs/archive/`): `BUG_HUNT_v4.md`, `CONTINUE_CHAT.md`, `RELEASE_NOTES_v4.0.1.md`, `V4_PLAN.md`, `release-notes-3.7.2.md`.
- `.gitignore` gained `/*.fbx` so the test asset `Gangnam Style (1).fbx` cannot be committed. Do not commit `upi-qr.jpeg` or `download.jpe` either (they were only sources for the donate repo).
- Last check: `node test/lint.js` 0 errors (2 old version warnings), `node test/validate.js` "ALL CHECKS PASSED", `node test/mcp-bridge-e2e-test.mjs` passes.
- `official-plugins/mcp-bridge` is now **1.3.0** (sends a token). `official-plugins/catalog.json` still lists 1.1.0 pointing at an old release zip; update before release.

### Everything in the unreleased Kanvaz work (see `CHANGELOG.md` "[Unreleased]" and `SECURITY.md`)
- **Platform:** Electron 44.4.3, electron-builder 26.15.3; **drops 32-bit Windows and macOS < 12**; `File.path` no longer exists so drops use `webUtils.getPathForFile` (`src/preload.js` `getPathForFile`, `src/app.js` `normalizeDroppedFiles`).
- **Security:** renderer `sandbox:true`; file IPC scoped to `.kanvaz` paths main granted (dialog, argv, recent list); UNC/remote/relative path refusal everywhere (NTLM leak); wider `shell-open-path` blocklist plus trailing dot/space and alternate-data-stream refusal; SSRF guard on URL previews; MCP Bridge per-start 256-bit token (`mcp-bridge.token`); plugin approval bound to content hash, symlink plugins refused (one-time re-consent for old approvals); `.blend` import runs with `--disable-autoexec --factory-startup` (proven with a hostile test file); `.kanvaz` zip-bomb limits; load-time validation of `dataUrl`, `urlPreview.image`, `objectFit`; glTF/USD external URIs neutralised (`makeLocalOnlyLoadingManager`); thumbnail validation; local crash log; CI hardening (read-only token, SHA-pinned actions, blocking `npm audit`, SBOM artifact, release checksums).
- **Fixes and features:** undo no longer wipes card fields (history copies every field generically); Blender detection any drive/version; hardened Blender conversion (timeout, drain, size cap); STL loads upright (Z-up), per-card **Up axis** switch in Properties; text and PDF file cards render inline (drop a `.txt/.md/.json/.log/code` or PDF); UI bugs from Window A.
- **Known limitations found during testing:** rigged/skinned USD renders lying and off-centre (use GLB); external textures beside an FBX are not loaded.

### Live-verification record (what was really tested)
Electron 44 dev run and a packaged Windows build: IPC guards refuse hostile calls; open/save via granted path; second-instance open; recent list; text preview shows hostile HTML as text; PDF preview; audio waveform; video frame-step and onion; 3D strip and picker; Map View wire cancel (4 paths); undo field preservation; S key after blur; hostile `.blend` payload did not run; FBX and its GLB/OBJ/STL/PLY/USDA/USDC/USDZ conversions rendered; MCP token live over the real named pipe (no/wrong token refused, right token returned board data); crash log written on a real renderer crash; plugin scan on the real 3,500-file MCP plugin folder (about 116 ms).
**Not tested:** native consent dialogs (plugin approve), macOS/Linux at all, CI workflow on GitHub, real phone UPI link, clipboard button in a real browser.

---

## 4. Kanvaz remaining work (excluding the README/donation polish)

Priority order suggested.

1. **Owner-gated release of the hardening work.** Needs: commit (stage specific files, not `git add .`), pull the 8 remote commits first, decide version number (suggest 9.0.0 because of the platform drop), update `catalog.json` and re-zip MCP Bridge 1.3.0, first real CI run of the new steps (expect surprises), then the draft-then-publish sequence. The owner has repeatedly said "do not ship yet" until verified.
2. **Code signing.** Windows Authenticode (SignPath for OSS or Azure Trusted Signing, eligibility unconfirmed) and Apple Developer ID plus notarization. Needs the owner's accounts and money. Release blocker for a professional audience and for Kanvaz Link.
3. **Licence decision.** Core is MIT in a public repo, so anyone can fork and sell it. Owner must decide MIT vs source-available before gaining users. Paid-plugin API v2 stays **unfrozen until the owner gives the plugin overview** (their words; this likely refers to Kanvaz Link or another plugin, confirm).
4. **Security items still open:** plugin process isolation (approved plugins run in the renderer with full bridge access), remaining unscoped IPC handlers (plugin storage, settings) and per-channel schemas, CSP `script-src file:` (needed for plugins; needs a live-tested change), hashes/SBOM for vendored libs (pdf.js 6.3.289, three r186, fflate 0.8.2; SHA-256 table was produced by the sweep agent, re-generate).
5. **3D render modes** (senior feedback: matcap and wireframe lose colour): Phase A rename "Normal" to "Shaded" and add Normals; B colour-preserving matcap/wireframe plus alpha view; C `onBeforeCompile` modes (depth, UV checker, AO) behind a registry; D registry opened to plugins (`registerRenderMode`). Plan in ROADMAP.
6. **Tag-bar redesign.** Owner said "we will do deep recon on it". Not started: audit the live bar with screenshots, list problems, propose one redesign for approval.
7. **More 3D and text card features** (owner feedback, not scoped).
8. **Smaller open bugs:** Map View label overlap where connection midpoints coincide; performance investigation needing owner profiling; README demo GIF re-record (removed earlier); Layers panel keyboard shortcut (none exists); Layers rename commit/focus finding (needs a human check); Map View "dangling curve" bug from memory notes (may be the stuck-wire fix, verify).
9. **Kanvaz-side dependencies for Kanvaz Link** (section 5): connector, capability handshake, animation clip picker, model hygiene, size and storage decisions, Draco/meshopt/KTX2 only if users need them. Full ordered list with sizes is in `F:\OBL\KanvazLink\docs\research\03-kanvaz-ground-truth.md` section 9.

---

## 5. Kanvaz Link (new project)

**What:** commercial Blender -> Kanvaz workflow product (select object, click Export to Kanvaz, a real 3D model card appears). Master spec (the owner's 94-section "overview", revision 1): saved verbatim at `F:\OBL\KanvazLink\docs\MASTER_SPEC.md`, extracted from the session transcript on 2026-09-21.

**Earlier overview (the "plugin overview" the owner meant):** `Kanvaz_Blender_Bridge_Project_Overview.pdf` (9 pages, dated 2026-09-17, original working name "Kanvaz Blender Bridge"). It was in `C:\Users\Admin\Downloads\`, not the Kanvaz repo root, and is now copied with a text extraction to `F:\OBL\KanvazLink\docs\source\`. It agrees with the master spec (same workflow, GLB default, local IPC, capability protocol, 10 s target, 5 to 10 year compatibility) and adds a 9-phase plan, tester questions, and a note that a later Kanvaz update should raise the model size limit. Other files in Downloads that may be related and were NOT used: `technical_architecture_overview_v0.1.md` (a different product: a private studio asset library and multi-DCC distribution platform, "for senior-partner review"), `enterprise_master_production_gdd_v5_0_editable_printable_html_master.html`, `deepseek_markdown_20260918_6d1632.md` (the audit framework already used), `ReadMe.md`. Ask the owner whether any of them is meant to be part of the plan.

**Location:** `F:\OBL\KanvazLink` (local git repo with 1 commit, **no GitHub remote**; do not create one without the owner). Files: `docs/00-decisions.md` (locked decisions and spec conflicts), `docs/01-feasibility-and-architecture.md` (spec section 92 parts A to F, decisions for owner in section G), `docs/research/01-blender-platform.md`, `02-commerce-and-security.md`, `03-kanvaz-ground-truth.md`.

**Locked by the owner this session:** GPL-licensed add-on (Superhive allows only GPL or MIT for code), paid value is the service (signed activation, updates, support); **V1 platforms Windows + macOS + Linux**; Kanvaz-side connector and core changes are built by us and free; separate private repo; first deliverable is documents, no production code until reviewed.

**Spec conflicts found (owner to confirm):** proprietary native licence component impossible/undurable (dropped); 10 s / 150 MB target unproven (Kanvaz embeds the model in the board file, autosave rewrites about 200 MB every 30 s, undo re-parses models; needs benchmark); Draco/meshopt/KTX2 not supported by Kanvaz so the add-on must export uncompressed GLB; cameras and lights have no receiving side; Blender 4.2 LTS ended (baseline 4.5 LTS, tested on 4.5 and 5.2); extensions.blender.org is not a channel.

**Architecture summary:** pure-Python Blender Extension, GPL-3.0-or-later, no wheels; export via `bpy.ops.export_scene.gltf` (GLB, embedded textures, no Draco); connector in Kanvaz **core** (`src/link-server.js`), named pipe / Unix socket, per-start token plus HMAC server proof, `hello`/`deliver`/`status`/`ping` only, deliver carries a **file path in a Kanvaz-owned private drop directory**, never bytes; native consent dialog once; capability negotiation instead of version checks; signed entitlement token `KLE1` (Ed25519), 30-day lease, renewal is a user button gated by `bpy.app.online_access`, expiry degrades never destroys; signed update manifest, add-on never self-installs. Phases: 0 spikes (IPC in Blender on 3 OSes, Kanvaz benchmark at 25/75/150 MB, exporter option introspection, Node pipe ACL, Superhive answers) -> 1 Kanvaz connector -> 2 add-on core -> 3 licensing -> 4 updates and diagnostics -> 5 hardening and beta -> 6 senior review and release.

**Decisions still needed from the owner (section G of the feasibility doc):** how to identify Superhive buyers (manual key / ungated core plus gated updates / order-number check); payment provider (Polar, Dodo, Gumroad advertise India payouts); listener default (on with consent, recommended, or off); Blender baseline 4.5 vs 4.2; whether Windows-first is acceptable if macOS and Linux test hardware is not available; lawyer review of GPL plus service terms.

**Key research facts (dated 2026-09-20, re-verify before launch):** Superhive Free plan 70% commission, 5.5% merchant fee, $0.49 per item; Pro $49/mo 80%; Ultimate $199/mo 90%; Superhive is merchant of record, 30-day refunds, no known buyer-list API. Direct sales: Polar 5% + 50c, Dodo 4% + 40c, Gumroad 10% + 50c (INR payouts). Stripe is not open to new Indian accounts. Several items are marked UNVERIFIED inside the research files.

**Kanvaz dependencies before Link can ship publicly:** release the hardening work, code signing, Link connector (change list items 1 to 4, 6, 5, 7 in research file 03), and a benchmark-informed size limit.

---

## 6. Donation, profile and README work (done; maintenance notes)

- **UPI:** `9321614988@jio`, payee Atharva Patil (JioFinance QR). QR image is `upi-qr.jpeg` in the Kanvaz repo root (untracked local copy) and in `p4inz-code/donate`.
- **`p4inz-code/donate` repo** (public, GitHub Pages at https://p4inz-code.github.io/donate/): `index.html` (flat purple, serif headline, faded profile picture as background art; phones show a "Pay with UPI" button, desktops show the QR; copy-ID button), `pfp.jpg` (official P4inz profile picture, source `download.jpe`), `qr.svg` (plain QR card used in READMEs), `upi-qr.jpeg`. GitHub strips `upi://` links in READMEs, so READMEs link to this page and the page holds the deep link `upi://pay?pa=9321614988@jio&pn=Atharva%20Patil&cu=INR&tn=Support%20P4inz`.
- **Donation block** (between `<!-- SUPPORT-BLOCK:START -->` and `<!-- SUPPORT-BLOCK:END -->`) is at the bottom of the README of all 18 public repos: mink, kanvaz, Draft, nexus-desktop, portfolio, project-ascent, Glint, p4inz, veris, repo-map, p4inz-code, pursue-os, mission-os, Crossport, obscura, docflow, reference-engineering, 3d-ref-skills. Private repos (northbyte-studio-tools, Obsidianlabs-Official-website-withPromo, downloadforge) were skipped. To change UPI details or the block, edit `docs/handoff-assets/donate-rollout/rollout.js` (`block()`), publish the page with `node rollout.js publish`, then `node rollout.js apply` (it replaces existing blocks by marker). Scripts use hardcoded scratchpad paths for the site folder (`SITE` in `publish()`); update them to `docs/handoff-assets/donate-rollout/site/`.
- **Profile repo:** `-p4inz-code` was renamed to **`p4inz-code`** so GitHub treats it as the profile README (confirmed `isUserConfigurationRepository:true`; the README renders on the profile). README now has followers/Kanvaz badges, a Featured Kanvaz section, an All Projects table (real repo descriptions), the original content, and the donation block. Profile-views badge was removed at the owner's request.
- **Kanvaz README:** original six badges and original install note restored verbatim (owner wanted previous content kept); added a second row: last commit, commits per month, Discord. Views badge removed. The original note still contains the typo "cross platform.see" (kept verbatim; fix if asked).
- **All-time stats (2026-09-20):** GitHub keeps only 14 days of traffic (Kanvaz: 432 views, 137 unique, 1,324 clones, 270 unique clones). All-time available: Kanvaz 22 stars, about 235 commits, 449 release downloads (v6.3.0 54, v4.5.1 48, v8.8.5 37, v5.2.0 37), 0 forks; 17 followers. The owner remembered "11k profile views"; nothing in GitHub data shows that. A scheduled task could save traffic snapshots if the owner wants history.
- **Design decisions:** minimal, purple, human copy (humanizer skill applied), no animation, no confetti, no link watermark.

---

## 7. Test and tooling recipes

- **Full checks:** `node test/lint.js` and `node test/validate.js` (also `node test/mcp-bridge-e2e-test.mjs`).
- **Live test of Kanvaz** (only after "I'm offline"): `node_modules/electron/dist/electron.exe --remote-debugging-port=9333 --user-data-dir=<scratch> .`, then drive it with `docs/handoff-assets/cdp/run.js <script.js>` (module exporting `async function(cdp)` with `cdp.eval/click/key/shot/send/sleep`) or `ev.js <exprFile> [shot.png]`. Use a **scratch user-data dir** so the real profile and recent list stay untouched (an early run polluted the real recents and was cleaned).
- **Gotchas learned:** `#startup-screen` is `position:fixed` so `offsetParent` is null even when visible (check `getBoundingClientRect`); after a renderer reload a recovery dialog appears (click Discard); the browser pane screenshot crops if the emulated viewport is larger than the pane (keep it about 800x700); do not pass an invalid path to CDP `DOM.setFileInputFiles` (crashes the renderer); Windows paths lose backslashes in bash heredocs; plugin storage is per profile directory (`profiles/<id>/plugin-storage`), not userData root; `git pull` the API-made README commits before pushing.
- **Blender for tests:** `F:\Blender\blender.exe`; headless scripts used to build a hostile `.blend` and to convert the FBX to glb/obj/stl/ply/usd (scratchpad, gone; recreate if needed).
- **Skills/agents used:** research agents for Blender, licensing and Kanvaz code analysis; design-critique and accessibility-review skills for the donate page audit (it had found 3.96:1 button contrast, small tap targets, landmark issues; all fixed); humanizer skill for copy. Headroom was installed earlier but is not on PATH in this shell (unverified); Ponytail requires the owner to run `/plugin marketplace add DietrichGebert/ponytail` and `/plugin install ponytail@ponytail` (the classifier blocked an automated settings edit). Token-saving research verdict: Headroom (beacon off), Ponytail, Serena, ccusage; skip RTK, Caveman, context-mode, claude-mem.

---

## 8. Immediate next steps for the next session

1. Read this file, `docs/ROADMAP.md` (hardening section), `F:\OBL\KanvazLink\docs\01-feasibility-and-architecture.md`.
2. Ask the owner: release the hardening work now? (then follow section 4 item 1); answers to the Kanvaz Link decisions in section 5; plugin overview for the paid-plugin API (the Kanvaz Link master spec, now saved as `MASTER_SPEC.md`, may already be that overview; confirm).
3. Without owner input, safe static work: Kanvaz Link Phase 0 spike scripts (no production code), 3D render mode Phase A design, tag-bar recon plan, CI review.
4. Before touching git in the Kanvaz repo: `git status`, `git fetch`, pull the remote README commits, stage specific files only.


---

## 9. Addendum, later on 2026-09-21: 9.0.0 released, then the next batch

### Release (done)
`v9.0.0` is published (`gh release view v9.0.0` shows `isDraft:false`, 15 assets, Latest). Commits: `fbb75ae` (hardening), `21954d2` (path-guard platform fix). Lessons worth keeping:
- **Push `main` before tagging.** CI's validate job caught a real failure that passed on Windows: `path-guard-test.js` ran Windows-path assertions on Linux while the guard used the host `path` module. Pushing without a tag ran validate only, so nothing was half-released.
- **CI created two draft releases for one tag** (a race despite `max-parallel: 1`): the Windows files landed on one, macOS/Linux on the other. Merge by downloading from the extra draft, uploading to the main one via the uploads API with the release id, verifying sizes and SHA-256 against the `SHA256SUMS-*` files, then deleting the extra draft. Check `gh api repos/p4inz-code/kanvaz/releases` after every tag build.
- `SHA256SUMS-windows-latest.txt` lists `Kanvaz 9.0.0.exe` (with a space) but GitHub names the asset `Kanvaz-9.0.0.exe`. Hashes are right, names differ.
- The CI-built portable exe was smoke-tested live before publishing (boot on Electron 44.4.3, sandbox on, IPC guards refuse hostile input, note + 3D card + undo/redo + Map View).

### Work after 9.0.0 (committed locally on `main`, NOT pushed, NOT released)
`1be161f` 3D modes + Blender export fixes + strip fix; `b76a578` clip picker, stats, Properties refresh; `5f06657` Map labels + no-op undo step; `3cd423c` Shift+L; plus tag-editor changes (see `git log`). Full list in `CHANGELOG.md` "[Unreleased]". Highlights: render modes are a registry (`src/model3d-modes.js`); `.blend` import exports only visible objects of the active scene and retries with WebP textures if too large (`src/blender-export.js`); the 3D hover strip was clipped by `.card{overflow:hidden}` and never showed (found by screenshot, not by DOM checks).
Tests added: `test/model3d-modes-test.js`, `test/blender-export-test.js`.

### Still open
Code signing; plugin process isolation and per-channel IPC schemas; licence decision and plugin API v2 (waiting on the owner's plugin overview); more 3D modes (depth, UV checker) and opening the registry to plugins; text-card features; Kanvaz Link (blocked on the owner's decisions in section 5); performance investigation (needs the owner's profiling); pdf/vendor hashes; one unexplained hang of the debug-port test instance seen once (not reproduced).
