# Kanvaz — Roadmap: v4.3 → v5.0 (final stretch)

*Living doc. Decided jointly (product judgement: user; technical scoping: assistant) — originally 2026-08-20, re-planned 2026-09-02 after the v4.6.x `.pur`/Map View work.*

## Framing

This is the last planned stretch of active feature development on Kanvaz — the user's own words: "these are the last versions of Kanvaz history." Four more releases, then development stops. This supersedes the original three-version plan below: v4.3.0–v4.6.1 already shipped (ahead of and beyond what this doc originally scoped — MCP Bridge, whole-app MCP access, and a critical `.pur` fix all landed as user-driven mid-course additions, not part of the original plan). What's actually left is scoped fresh, below, based on what users are showing real interest in: Map View and `.pur` import specifically.

Standing constraint carried through all of it: **100% offline core, no accounts, no telemetry.** Any network-touching feature must be a separate opt-in plugin, off by default, disclosed plainly — never baked into core, never silent.

---

## Shipped — v4.3.0 through v4.6.1

Full detail in `CHANGELOG.md` and `docs/HANDOFF.md`'s "Where things stand technically" section. Summary:

- **v4.3.0** — Command Palette, plugin `registerCommand`/`.on(event)`, Runtime Data API.
- **v4.4.0** — MCP Bridge (flagship plugin), real per-plugin permission enforcement, CI plugin packaging, Browse Official Plugins, Load unpacked plugin.
- **v4.5.0** — MCP Bridge widened to whole-app access (30 tools) — not originally planned, added mid-session by request.
- **v4.5.1** — CI release-build fix (electron-builder macOS hard-link bug) — no app changes.
- **v4.6.0** — Text card type, Map View inline rename + hover preview, bigger resize handles, critical `.pur` import hang fix, auto-updater confirmation flow, a dozen other real bugs fixed (undo snapshot aliasing, viewport restore, media leaks, annotation position/flip, zoom stepping, and more).
- **v4.6.1** — `.pur` importer fixed against a *real* PureRef file (v4.6.0's fix only covered synthetic test fixtures): multi-format detection (PNG/JPEG/GIF/BMP), corrected header-offset assumption, correct item/image interleaving, and a grid-fallback safety net when exact positioning can't be recovered.

---

## v4.7.0 — Organize & Connect

**Goal:** everything about seeing and managing a growing board — the areas users are actually asking about, Map View and card organization, tackled together since they're thematically the same problem (navigating many cards at once).

- **Board View: card renaming** — mirrors Map View's existing double-click-to-rename (shipped in 4.6.0). Currently the card-bar name is a plain non-editable `<span>` (`cards.js`) — confirmed gap, not assumed. Goes through the same `updateCardData()` path everything else uses, so undo/dirty-flag/MCP Bridge stay in sync automatically.
- **Map View: search/filter** — find a card by name/tag/type without leaving Map View.
- **Map View: multi-select + bulk actions** — marquee or shift-click to tag/delete/move several nodes together.
- **Map View: color-code nodes by tag or type** — visual grouping at a glance.
- **Tag chip resize polish** — tag chips are a flat `9px` in `main.css`, completely unresponsive to card size, unlike the video/audio scrub-time label right next to them (`clamp(10px, 3.5cqw, 16px)`). Give tags the same proportional treatment.
- **Video/audio control resize polish** — the 140px/200px hide-thresholds are instant `display:none` cliffs, not smooth. Replace with a transition.
- **Grid zoom-range increase** — the dot-grid background has limited range and disappears when zoomed way out. Not yet investigated; start with `resizeGrid()` in `canvas.js`.

**Done bar:** `validate.js` + `format-roundtrip-test.js` clean. Real Electron-GUI manual smoke test of every item above (this sandbox can't run the app — needs a human pass). No regressions in existing Map View/card-resize behavior.

---

## v4.8.0 — `.pur`: Full Round-Trip

**Goal:** a dedicated release for the killer feature, not a few bullet points buried in a mixed release. `.pur` import already works against real files (v4.6.1) — this is about making the whole PureRef relationship excellent, not just functional.

- **Export back to `.pur`** — true round-trip compatibility with PureRef, not import-only.
- **Better import fidelity** — groups, rotation, exact scale (the current parser only recovers flat position/scale for individual images).
- **Preserve exact z-order on import** — the parser already extracts `zLayer` and sorts by it; wire it through to actual card stacking on create.
- **Broader format detection** — WebP and TIFF, beyond the PNG/JPEG/GIF/BMP v4.6.1 added. Live-test against real files with each format before calling it done, per the v4.6.1 lesson: synthetic fixtures alone did not catch real format assumptions being wrong.
- **Folder-drop auto-arrange** — drop a folder of loose images and get the same grid-arrange behavior `.pur` import's own fallback path already has (direct code reuse from v4.6.1's grid-fallback logic).

**Done bar:** export → re-import round-trips cleanly. At least one real-world test file per newly-supported format, not just synthetic ones (the v4.6.1 near-miss makes this non-negotiable). `validate.js` clean.

---

## v4.9.0 — Closing the Drawer

**Goal:** every remaining real annoyance and open thread gets swept up here, so v5.0.0 starts from a genuinely clean slate.

- **Annotation resize-drift fix** — flagged since 4.6.0 as "known, not fixed": stroke coordinates don't rescale when a card is resized, so annotations drift after save/reload on any card that was ever resized. Make the actual decision (normalize to 0..1, or a save-format migration) and implement it — no more deferring.
- **Utility ideas** (from user's own "ease user pain" ask): recently-used tags for one-click re-add, remembered last-used size per card type, snapping/alignment guides between cards, "zoom to selection."
- **Old backlog, revisited** (deprioritized in favor of Map View/`.pur`, not abandoned): URL card completeness check, color-card multi-swatch/palette mode, note markdown preview.
- **`[data-theme="light"]` CSS cleanup** — hardcoded selectors → luminance-derived, so third-party light themes stop silently inheriting dark-tuned edge cases.
- **Plugin authoring docs + scaffold template** — the plugin system and MCP Bridge both work today, but there's no "how to build a Kanvaz plugin" guide or starting template; anyone extending Kanvaz has to reverse-engineer it from `official-plugins/`.
- **Auto-update download progress** — the update flow now asks before downloading (v4.6.0), but gives no feedback during the download itself beyond silence until "ready to restart."

**Done bar:** every item above either ships or gets an explicit, reasoned "not doing this, here's why" in `CHANGELOG.md` — nothing just quietly disappears. `validate.js` clean.

---

## v5.0.0 — Finish Line

**Goal:** nothing new starts here. Verify, polish, document, stop.

- One more full-stack audit pass — same standing methodology as `docs/AUDIT_METHODOLOGY.md`, across the full v4.7–v4.9 diff.
- Confirm the two deferred `canvas.js` findings from the 4.2.1 audit are actually resolved — the additive-zoom-step one is very likely already fixed as a side effect of 4.6.0's multiplicative zoom rewrite; verify rather than assume, and check the viewport-clamp-at-extreme-pan one separately since nothing since has touched that path.
- Real manual Electron-GUI smoke test of everything shipped across v4.7.0–v4.9.0 as a whole, not just per-release (this sandbox cannot run the app at all — confirmed by direct test — so this has never actually been done end-to-end for any of this arc).
- Final version bump, final CHANGELOG "state of the app" entry.
- Zero "defer to later" language left anywhere in the docs.

**Done bar:** `validate.js` + `format-roundtrip-test.js` clean. Every card type and Map View feature manually smoke-tested. `SECURITY.md`/`README.md` fully accurate as of the actual final state. No further versions planned after this one.

---

## Not a version, flagged so it doesn't get lost

The website update has been explicitly held off multiple times — release/CHANGELOG work first, website is a separate deliberate joint step. Once v5.0.0 ships, that's the natural moment to revisit it.

Full per-plugin process isolation remains explicitly declined (multi-week rearchitect, not worth it against the current plugin ecosystem size) — logged as deliberate future work in `SECURITY.md`, not a gap anyone missed. Don't propose re-opening this without the user raising it.

**Free template gallery — raised mid-session, not yet scoped.** User's own framing: growth/marketing motivated ("im also marketing my apps highly i want kanvaz to go viral atp"), pointing at [storyflow.so/templates/filmmaking](https://storyflow.so/templates/filmmaking) as a reference for what a template-gallery page could look like — pre-built starter boards (by use case: filmmaking, game art, mood boards, etc.) a new user can drop straight into an empty board, free, as an acquisition/onboarding hook. Not investigated yet: whether this is a small in-app feature (a "Start from template" option alongside "New Board", shipping a handful of `.kanvaz` files with the app or fetched from a small catalog the same way Browse Official Plugins already works) or a bigger website/landing-page play outside the app entirely. Needs a real scoping pass before it goes into a numbered version — don't assume either shape without asking.
