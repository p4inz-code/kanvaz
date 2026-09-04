# Kanvaz — Roadmap: v4.3 → v5.3 (final stretch, closed) + v6.x (the real final arc)

*Living doc. Decided jointly (product judgement: user; technical scoping: assistant) — originally 2026-08-20, re-planned 2026-09-02, 2026-09-03, and 2026-09-04 (v5.3.0's close-out), reopened again 2026-09-04 for the v6.x arc below.*

**Everything from "Shipped — v4.3.0 through v4.6.1" down to "v5.3.0 — Finish line" is historical record — that arc genuinely finished and shipped as planned.** What follows this note is the NEW, currently-active plan: a full market analysis against PureRef and every other major competitor in this space (Milanote, Are.na, Eagle, Kosmik, ArtDeck), aimed at closing every real remaining gap in one considered, deliberately final push. v5.3.0's "last release" framing was accurate for the decision made at that moment, not a promise broken by this — the user chose to reopen development with a bigger, more specific target in mind. See "The v6.x arc" section, below the historical record, for the current plan and status.

## Framing

This is the last planned stretch of active feature development on Kanvaz — the user's own words: "these are the last versions of Kanvaz history." This supersedes the original three-version plan below: v4.3.0–v4.6.1 already shipped (ahead of and beyond what this doc originally scoped — MCP Bridge, whole-app MCP access, and a critical `.pur` fix all landed as user-driven mid-course additions, not part of the original plan). What's actually left is scoped as **four feature releases (v5.0.0–v5.2.0, plus v4.9.0's own remaining items folded into v5.2.0) and a fifth, final polish/future-proofing pass (v5.3.0)** — the user's own framing for how this stretch ends.

Standing constraint carried through all of it: **100% offline core, no accounts, no telemetry.** Any network-touching feature must be either a separate opt-in plugin (off by default) or, as of v5.0.0, an individually-disclosed opt-in-per-click exception in core (see SECURITY.md) — never automatic, never silent, never baked in as a background behavior.

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

**Shipped, partially — scoped down under real time pressure (3 releases requested in one sitting).** Only "Broader format detection" (WebP) and "Folder-drop auto-arrange" actually landed in v4.8.0. Export, better fidelity, TIFF, and z-order preservation are all still open — carried forward to a genuinely dedicated future `.pur` pass rather than rushed, per `CHANGELOG.md`'s 4.8.0 entry. Original goal below, unchanged, since it's still the right goal — just not what v4.8.0 itself delivered.

**Goal:** a dedicated release for the killer feature, not a few bullet points buried in a mixed release. `.pur` import already works against real files (v4.6.1) — this is about making the whole PureRef relationship excellent, not just functional.

- **Export back to `.pur`** — true round-trip compatibility with PureRef, not import-only.
- **Better import fidelity** — groups, rotation, exact scale (the current parser only recovers flat position/scale for individual images).
- **Preserve exact z-order on import** — the parser already extracts `zLayer` and sorts by it; wire it through to actual card stacking on create.
- **Broader format detection** — WebP and TIFF, beyond the PNG/JPEG/GIF/BMP v4.6.1 added. Live-test against real files with each format before calling it done, per the v4.6.1 lesson: synthetic fixtures alone did not catch real format assumptions being wrong.
- **Folder-drop auto-arrange** — drop a folder of loose images and get the same grid-arrange behavior `.pur` import's own fallback path already has (direct code reuse from v4.6.1's grid-fallback logic).

**Done bar:** export → re-import round-trips cleanly. At least one real-world test file per newly-supported format, not just synthetic ones (the v4.6.1 near-miss makes this non-negotiable). `validate.js` clean.

---

## v4.9.0 — Closing the Drawer

**Shipped, partially — under real time pressure.** Only "Auto-update download progress" and "zoom to selection" (pulled out of the Utility ideas line below) landed in the numbered v4.9.0 release. The annotation-drift fix and the rest of this list are now folded into v5.0.0/v5.2.0 below rather than kept as a permanently-open v4.9.0 — see those sections for current status.

- ~~Annotation resize-drift fix~~ — **done, v5.0.0.**
- **Utility ideas** (from user's own "ease user pain" ask): recently-used tags for one-click re-add, remembered last-used size per card type, snapping/alignment guides between cards. → v5.2.0.
- **Old backlog, revisited**: color-card multi-swatch/palette mode, note markdown preview. → v5.2.0. (URL card completeness became the URL preview feature — done, v5.0.0.)
- **`[data-theme="light"]` CSS cleanup** → v5.2.0.
- **Plugin authoring docs + scaffold template** → v5.2.0.

---

## v5.0.0 — Annotation drift fix, URL/File card previews

**Shipped.** See `CHANGELOG.md` for full detail.

- **Annotation resize-drift fix** — strokes now store as 0–1 fractions of card size instead of absolute pixels; old saves self-migrate on load.
- **URL card: "Fetch preview" button** — one-click title/thumbnail fetch, the one disclosed opt-in-per-click exception to the offline-core promise (see SECURITY.md).
- **File card: type-specific icon** — extension-derived label (PDF/ZIP/DOC/etc.) instead of one flat folder icon.

**Done bar met:** `validate.js` clean. Manual Electron-GUI smoke test of both new preview features and the annotation-resize path still needed (this sandbox cannot run the app — see v5.3.0's smoke-test item, which covers this release too).

---

## v5.1.0 — Template gallery

**Shipped.** See `CHANGELOG.md` for full detail.

**Goal:** the free-template-gallery idea, finally scoped and shipped (raised mid-session, referencing [storyflow.so/templates/filmmaking](https://storyflow.so/templates/filmmaking) as a reference point) — an acquisition/onboarding hook: pre-built starter boards a new user can drop straight into an empty board, free.

- **Shape decision:** an in-app "Start from Template" option next to "New Board," not a separate website/landing page — reuses the same bundled-catalog pattern Browse Official Plugins already established, so it's the smaller, faster, more maintainable option and stays consistent with the rest of the app's UX.
- A handful of bundled `.kanvaz` starter files (by use case — filmmaking, game art, mood board, to start) shipped alongside the app, not fetched from a remote catalog — keeps this feature 100% offline, no network exception needed for it at all.
- Template picker UI: a simple grid/list dialog off the "New Board" button, each entry with a name + short description.

**Done bar:** at least 3 real starter templates, each opens cleanly as a real board. `validate.js` clean.

---

## v5.2.0 — Remaining backlog sweep

**Shipped.** See `CHANGELOG.md` for full detail.

**Goal:** every item still open from v4.9.0's original list gets a real pass, closing that list out for good.

- Recently-used tags, remembered card size per type, snapping/alignment guides
- Color-card multi-swatch/palette mode, note markdown preview
- `[data-theme="light"]` CSS cleanup — hardcoded selectors → luminance-derived
- Plugin authoring docs + scaffold template
- Bulk-tag-per-card undo batching (Map View multi-select still pushes one undo entry per card instead of one per batch — flagged since v4.7.0)

**Done bar:** every item above either ships or gets an explicit, reasoned "not doing this, here's why" in `CHANGELOG.md` — nothing just quietly disappears. `validate.js` clean.

---

## v5.3.0 — Finish line: bug bounty, fixes, and what's next

**Shipped.** See `CHANGELOG.md` for the full writeup. Goal was: nothing new starts here — verify, polish, document, stop — the fifth and final release of this stretch, and the last actively-developed version of Kanvaz for the foreseeable future (the user's own framing). Active feature development by p4inz-code ends here; further feature requests go through GitHub issues or direct email, not a continued release cadence.

**What actually happened, honestly scoped:**
- **Real audit/bug-hunt pass, done.** 8 parallel finder passes (correctness line-by-line, removed-behavior regression audit, cross-file caller/callee trace, reuse, simplification, efficiency, architectural-depth, and a CLAUDE.md conventions check — none applied, no CLAUDE.md exists in this repo) across the full v4.7.0–v5.2.0 diff. 8 real, confirmed bugs fixed before shipping — see `CHANGELOG.md`'s "Fixed (found by this release's own audit pass)" section for the full list, including a genuine regression the v5.2.0 theme cleanup itself introduced (light-theme pinned+selected card shadow) and a real data-corruption path (annotation migration math while Map View is active). 2 more findings (reuse/duplication, not bugs) were logged but deliberately left unrefactored — see CHANGELOG's "Known, deliberately not refactored" note.
- **NOT done, disclosed rather than silently skipped:** the two deferred `canvas.js` findings from the 4.2.1 audit (additive-zoom-step, viewport-clamp-at-extreme-pan) were not specifically re-verified this pass — the 8-angle bug-bounty above covered the v4.7–v5.2 diff, not a re-audit of pre-4.7 code untouched since. Also not done: a real manual Electron-GUI smoke test of the full v4.7.0–v5.3.0 arc end-to-end — this sandbox has never been able to run the app at all (confirmed by direct test throughout this entire stretch), so every fix in this release (like every feature in v5.0.0–v5.2.0) is logic-verified and `validate.js`-clean, not eyes-on-screen verified. This is a real, standing gap for whoever picks up a genuine bug report against this code going forward, not a claim that's being quietly dropped.
- Final version bump: done. Final CHANGELOG "what's next" entry: done — see CHANGELOG's v5.3.0 section.

**Done bar, honestly assessed:** `validate.js` + `format-roundtrip-test.js` clean — yes. Every card type and Map View feature manually smoke-tested — no, per the disclosed gap above. `SECURITY.md`/`README.md` accurate as of the actual final state — yes. No further versions planned after this one — confirmed, per the user's own instruction to close out development here.

---

# The v6.x arc — the real final push

Reopened 2026-09-04, after a full market analysis against PureRef, Milanote, Are.na, Eagle, Kosmik (a cloud-AI-heavy competitor that shut down in 2026 — a real cautionary tale, not a hypothetical), and ArtDeck. Goal, in the user's own words: beat PureRef at everything it does, add what nobody else has done well, and leave Kanvaz in a strong enough state that it needs no attention for at least 2 years. Three pillars plus a dedicated polish pass, each shipping as its own tested, audited release rather than one giant untestable change.

**Standing design rule for this whole arc:** any AI feature must ship with a real, complete off switch from the day it's written, not bolted on after. Nothing AI-related should touch disk or memory when that switch is off.

## Pillar "Live Reference" — beat PureRef at its own game

- **v6.0.0 — shipped.** Always-on-top now defaults to on; click-through + adjustable window opacity ("Reference Mode," T key) let you trace/color-match straight through the Kanvaz window into whatever's underneath — PureRef's actual signature move, finally complete. Top Mode removed entirely (redundant once always-on-top is the default). See `CHANGELOG.md`'s 6.0.0 entry for full detail, including the settings migration that applies the new default to existing users too, disclosed rather than silent.
- **Not yet done:** pinning on top of one specific app only (PureRef 2.0's newer trick — flagged from the start as needing real OS-specific focus-tracking code per platform; may end up out of scope if it proves too fragile to trust). Video frame-stepping + onion-skinning for video cards. A measuring tool and a color eyedropper, added to the existing annotation toolset.

## Pillar "Never Lose Anything Again" — search & organization

Not started. Planned, in build order (safest/most-isolated first):
1. Smart Folders (a saved search that keeps re-running itself) and color search across image cards — no architecture change needed, safe first wins.
2. Local AI search — fully on-device, own background thread (same pattern as `.pur` import's worker), its own private data folder completely separate from `.kanvaz` files so the AI off-switch means literally nothing AI-related exists on disk when it's off.
3. Cards shared across boards within one file (the Are.na-style "same card, no duplicate, edit once updates everywhere" trick) — the hardest, most invasive piece, saved for last in this pillar specifically so it's the most tested before shipping. Needs a real save-format addition with the same old-files-still-open-fine discipline every prior format change in this project has kept.

## Pillar "Wide-Open Plugin Ecosystem"

Not started. Planned:
- A richer plugin API (new hooks beyond what's available today), versioned so existing plugins keep working unchanged.
- A full rewrite of `docs/PLUGIN_AUTHORING.md` and `docs/plugin-scaffold/` to demonstrate the new capabilities.
- An official, documented green light for plugin authors to sell their own plugins outside Kanvaz (their own site/Gumroad/Patreon) — no in-app payments or marketplace, deliberately: the moment Kanvaz processes money it's on the hook for refunds/fraud/tax forever, exactly the ongoing liability this arc is trying to avoid by going otherwise-server-free everywhere else.
- Template Maker & Manager, as its own new official plugin: save any board as a template, manage your own, and browse/install ones other people made through the same free, static-GitHub-catalog trick "Browse Official Plugins" already uses (no server, no ongoing hosting cost). Community submissions handled the open-source way (a PR against the catalog file), not something requiring ongoing manual curation forever.

## Final phase — UI polish

Not started, and deliberately last. Once every pillar above is built and tested, one dedicated pass over every new screen/button/dialog added by this whole arc: visual consistency against Kanvaz's existing design system, correctness in both light and dark theme, and the same level of care as the rest of the app — done last on purpose, so it reflects what actually shipped instead of getting redone every time a feature underneath it changes.

---

## Not a version, flagged so it doesn't get lost

The website update has been explicitly held off multiple times — release/CHANGELOG work first, website is a separate deliberate joint step. With development now closed out at v5.3.0, this is unscoped future work if the user chooses to pursue it — not part of the app's own release cadence.

Full per-plugin process isolation remains explicitly declined (multi-week rearchitect, not worth it against the current plugin ecosystem size) — logged as deliberate future work in `SECURITY.md`, not a gap anyone missed. With development closed out, this stays declined; it isn't something a GitHub issue against this repo should expect to reopen.

~~Free template gallery — raised mid-session, not yet scoped.~~ **Done, shipped in v5.1.0.** Scoped as an in-app "Start from Template" button (not a website/landing-page play) with 3 bundled starter boards — see `CHANGELOG.md`'s v5.1.0 entry.
