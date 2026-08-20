# Kanvaz — Session Handoff

*For a fresh Claude session picking this project up. Read this first.*

## What Kanvaz is

Kanvaz is an Electron desktop app — a visual reference-board tool ("Reference Operating System") for VFX/3D artists and creative studios, built by Atharva Patil (Northbyte Studios). Repo: `p4inz-code/kanvaz`. Current shipped version: **v4.2.2** (tagged and pushed; CI release pipeline runs on `v*` tags). **v4.3.0 is implemented and validated in this working copy but NOT yet tagged/released** — see "Where things stand technically" and the bottom of this file for exactly what's done and what's still needed before it ships.

Core identity, non-negotiable: **100% offline. No accounts. No telemetry.** The only network call anywhere in the app is a user-triggered "Check for updates" click. Any future feature that touches the network must be narrow, opt-in, and explicitly disclosed in the About screen / README / SECURITY.md — never silent. This constraint has shaped several past product decisions and should keep shaping future ones, including the MCP Bridge plugin planned for v4.4 (see below) — it's a local-only listener, Kanvaz never calls out.

## Where things stand technically

- **Plugin system (v4.2.0+)** is the newest architectural layer: `window.KanvazPluginAPI` lets a plugin register card types, full themes, and Settings panels. Convention-based sandbox (plugin JS runs in the same page context, not iframe-isolated) — disclosed, not hidden. Native OS `dialog.showMessageBox` consent gate on install/permission-escalation, enforced in the main process only.
- **Theme Creator** shipped as the first official plugin, distributed as a separate release asset (`kanvaz-theme-creator-1.0.0.zip`), not bundled into the base installer.
- **File format**: `.kanvaz` is a zip container (`board.json` + per-asset files with SHA-256 hashes) since v4.1.0. Old plain-JSON files still open fine.
- **v4.2.1** was a full-stack audit + hardening pass (data-loss bugs, plugin robustness, security, shortcut bugs, UI-copy-vs-reality corrections).
- **v4.2.2** was a design-consistency + reliability polish pass: unified radius/shadow/animation across every panel and dialog, emoji→SVG icon replacement, native connection-type color palette, fixed Top Mode's drag-bar vanishing mid-drag, fixed Map View connections drifting after window resize.
- **v4.3.0 (implemented this session, not yet released)** — Command Palette & Plugin Runtime API, per `docs/ROADMAP.md`'s v4.3.0 spec, in the exact build order it named:
  1. Runtime Data API on `KanvazPluginAPI`: `getCards()`, `getSelected()`, `getConnections()`, `getActiveBoard()` — read-only clones, not live references.
  2. `KanvazPluginAPI.registerCommand(id, def)` and `KanvazPluginAPI.on(event, handler)` for `cardCreate`/`cardUpdate`/`cardDelete`/`boardLoad`/`boardSave`/`selectionChange`. New `src/commands.js` owns the actual command registry (registration validation, fuzzy-match scoring) — deliberately zero-DOM-dependency at that layer, so `test/command-registry-test.js` requires it directly in plain Node, not just a manual smoke test.
  3. Ctrl+K Command Palette UI (`KanvazCommands.openPalette`/`closePalette`/`togglePalette`), built lazily on first open like the existing search bar/opacity picker. `shortcut` shown per-row is a **display hint only** — the actual key handling for Kanvaz's own shortcuts still lives in `shortcuts.js`'s existing dispatcher, unchanged; the palette's core commands call the exact same functions that dispatcher already calls. Two bindings pointing at one action, deliberately, not a rebind.
  4. Dogfooded: ~24 of Kanvaz's own shortcuts registered as palette commands (`registerCoreCommands()` in `commands.js`), and Theme Creator registers one real command ("Randomize Preview") proving the plugin-facing API end to end.
  - `cardCreate`/`cardUpdate`/`cardDelete` fire from `src/cards.js` at every point that already triggers an undo-history push there (all 6 create paths, delete, drag/resize/flip/pin/nudge/relink/tag edits/etc.) — **deliberately NOT yet wired into `annotate.js`/`map-view.js`/`inspector.js`/`properties.js`'s own separate `KanvazHistory.push()` call sites**, logged as real follow-up, not an oversight (see the comment above `emitCardEvent()` in `cards.js`).
  - `boardLoad`/`boardSave` fire from `src/boards.js` on new/switch/open and on a real Save/Save As landing on disk — deliberately NOT on autosave's recovery-file write (same reasoning as autosave never touching `currentPath`).
  - Verified in real headless Chromium (this sandbox can't run the full Electron GUI — see below) via two scratch Puppeteer harnesses exercising `commands.js` and `plugin-api.js` directly: palette open/close, fuzzy search ranking, arrow-key nav, Enter/Escape, and the full Runtime Data API + event system all passed. Not committed to the repo (they were throwaway verification, not permanent tests) — `test/command-registry-test.js` is the one new permanent automated test.
  - `node test/validate.js` passes clean, including the new "6. Command registry" section.
  - **Not done, left for whoever tags the release:** manual smoke test in the *actual* Electron app window (`npm start`) — this sandbox's Electron renderer crashes on launch for an environment reason unrelated to these changes (confirmed by reproducing the identical crash on a clean `git stash` of unmodified v4.2.2 code first). Do that manual pass, plus the git tag/push, before calling v4.3.0 released.
- Full CHANGELOG.md history goes back to v3.5.x.

## THE PLAN IS DECIDED — read `docs/ROADMAP.md`

The three-version final-stretch plan the previous session was asked to produce is now **written and committed**: `docs/ROADMAP.md`. Read that file for full version-by-version scope, done bars, and reasoning. Do not re-litigate it from scratch — it reflects the user's own product judgement plus a joint decision on the one open technical question (plugin trust-model scope). Summary:

- **v4.3.0 — Command Palette & Plugin Runtime API.** `registerCommand`, Ctrl+K palette, `KanvazPluginAPI.on(event, handler)` hooks, and the Runtime Data API (`getCards`/`getSelected`/`getConnections`/`getActiveBoard`) that was speced in `docs/PLUGIN_SYSTEM_DRAFT.md` but never shipped.
- **v4.4.0 — Plugin ecosystem: hardening, distribution & MCP Bridge.** Flagship new official plugin: a local MCP server exposing the active board to Claude Code / Claude Desktop / any MCP client (list/create/update/delete cards, add references, tag, search, connect cards). Off by default, every AI-driven change lands in undo history like a manual edit. Ships alongside: enforcing the plugin permission model as originally designed (declared-permission namespaces literally absent from the API object if undeclared — cheap, closes a real honesty gap, matters more now that a high-permission plugin exists), CI packaging automation for official-plugin release assets, a "Browse Official Plugins" catalog tab, and a "Load unpacked plugin" dev workflow.
- **v5.0.0 — Finish line.** No new work starts here. Closes every remaining open thread: `V4_PLAN.md`'s deferred backlog (URL cards, color palette mode, note markdown preview), remaining cross-card polish, the `[data-theme="light"]` hardcoded-selector cleanup, the two deferred `canvas.js` findings from the 4.2.1 audit, one more full-stack audit pass, and plugin authoring docs (including an MCP Bridge quickstart). This is the last planned version — development stops after it ships.

**Full per-plugin process isolation was explicitly considered and declined** for this stretch (multi-week rearchitect, not worth it against a two-version budget and a one-plugin ecosystem) — logged as deliberate future work in `SECURITY.md`, not a gap anyone missed. Don't propose re-opening this without the user raising it.

## What's being asked of the next session

**v4.3.0 is implemented and validated — release it, then start v4.4.0.** Concretely, in order:
1. Hand the user the version-bump commit + tag/push (Git Bash only, per rule #1 below) — nothing was committed or pushed this session, only the working copy was changed.
2. Do the one thing this sandbox couldn't: launch the real Electron app (`npm start`) and manually click through Ctrl+K — open/close, fuzzy search, arrow nav, running a few commands (including Theme Creator's "Randomize Preview" with Settings → Plugins → Theme Creator enabled), and confirm nothing else regressed. See "Where things stand technically" above for exactly why this was skipped and what *was* verified instead (real headless-Chromium checks of the same palette/event/data-API code).
3. Only after that: start v4.4.0 per `docs/ROADMAP.md` — MCP Bridge, permission enforcement, distribution. Read that section fresh; nothing about it was touched this session beyond the standing note in rule #7 below.

If genuinely blocked on a product-judgement call `docs/ROADMAP.md` doesn't already answer, ask one targeted question rather than guessing — same standing rule as always (see below).

## Standing working rules for this project

1. **I never run git commands myself.** Any git action (commit/tag/push) is handed to the user as a single chained Git Bash command, always starting with `cd`, clearly labeled "Git Bash only." The user runs it in their own terminal against the same real `F:\OBL\Kanvaz` folder my sandbox mounts.
2. **Version bumps touch 6 canonical locations** (+1 non-canonical): `package.json`, `package-lock.json` (both spots), `src/boards.js` `VERSION` const, `src/ui.js` About screen (two strings), `README.md` build-output filenames, and `docs/generate_overview_pdf.py`'s version pill (this last one is NOT covered by `test/validate.js`'s automated check — verify it by hand every time).
3. **`node test/validate.js` and `node test/format-roundtrip-test.js` must both pass clean before any release is considered done.** Port-alignment will SKIP in a sandbox with no real Chrome binary — that's expected, not a failure.
4. **The website is explicitly off-limits until the user says so.** Release/CHANGELOG work happens first, website updates are a separate, deliberate, joint step — flagged in `docs/ROADMAP.md` as the natural thing to revisit once v5.0 ships.
5. **Don't guess-patch UI bugs from static code alone.** Code that looks correct on read has more than once turned out to have a real, different bug once the user clarified specifics. Ask one targeted clarifying question rather than shipping a speculative fix.
6. Kanvaz's own linter (`test/lint.js`) enforces ES5 `var`-only style, scoped to `src/` only — not `official-plugins/` or `test/`. Third-party and official plugins are NOT bound by this rule (a plugin is just a `<script>` tag).
7. **A new permission scope will be needed for v4.4's MCP Bridge** — it needs to *listen* for local connections, which is a different capability than the existing `network`/`fs` namespaces in `docs/PLUGIN_SYSTEM_DRAFT.md`. Decide the exact shape (new `server` permission vs. extending `network`) during v4.4 implementation, not before — noted here so it isn't forgotten, not because it's already decided.

## Everything else

Full line-by-line file history, exact code diffs, and the complete CHANGELOG text for v3.5.x–v4.2.2 are available by reading `CHANGELOG.md` and `docs/AUDIT_REPORT_4.2.1.md` directly in the repo. The original plugin design vision (partially superseded by `docs/ROADMAP.md`'s decisions above, especially the AI-plugin concept and trust-model scope) is in `docs/PLUGIN_SYSTEM_DRAFT.md`. Don't rely on this handoff for exact wording anywhere — it's a map, not the territory.

Two other repo-root files (`SESSION_MEMORY.md`, `CONTINUE_CHAT.md`) are **stale artifacts from earlier, since-superseded "final release" moments** (v2.0.1 and v3.8.0 respectively) — historical record only, not live handoff docs. This file and `docs/ROADMAP.md` are the current source of truth.
