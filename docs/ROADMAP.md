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
- **v6.1.0 — shipped.** Measure tool and eyedropper added to the annotation toolset; video frame-stepping (~1/30s steps) and onion-skin ghosting for checking timing/spacing. See `CHANGELOG.md`'s 6.1.0 entry.
- **Not yet done, and possibly out of scope:** pinning on top of one specific app only (PureRef 2.0's newer trick — flagged from the start as needing real OS-specific focus-tracking code per platform; may end up staying out of scope if it proves too fragile to trust versus the plain always-on-top already shipped). This is the one remaining open item in this pillar.

## Pillar "Never Lose Anything Again" — search & organization

Build order is safest/most-isolated first:
1. **v6.2.0 — shipped.** Smart Folders (a saved search that keeps re-running itself) and color search across image/color cards, both built directly on the existing Board View search with no architecture change. See `CHANGELOG.md`'s 6.2.0 entry, including two disclosed scope boundaries (video cards skipped for color search; Map View's own search doesn't get either feature this pass, deliberately not adding to its already-flagged duplication of Board View's search logic).
2. **v6.3.0 — shipped, with a real architecture pivot along the way.** Local AI search shipped as "Smart Search": lemmatized/fuzzy text matching via `wink-nlp` (pure JS, zero native dependencies), not the originally-planned transformer model — `@xenova/transformers` was tried first and reversed before anything was committed, once it turned out to require `onnxruntime-node`/`sharp` (native binaries needing Electron-ABI rebuilds this project has no CI for). Off by default; the worker only spawns when explicitly enabled. See `CHANGELOG.md`'s 6.3.0 entry for the full story and a real bug-bounty pass (6 findings, all fixed) before shipping.
3. **v6.4.0 — shipped.** Cards shared across boards within one file (the Are.na-style "same card, no duplicate, edit once updates everywhere" trick) — the hardest, most invasive piece, saved for last in this pillar specifically so it got the most scrutiny before shipping. Added a `sharedCards` registry to the save format (fully additive, no migration needed for old files) and caught a genuinely severe bug in its own pre-ship review: undo/redo was silently corrupting any shared card by snapshotting the save-file's content-less stub instead of the card's full live state. See `CHANGELOG.md`'s 6.4.0 entry for the full writeup.

**This closes out the "Never Lose Anything Again" pillar.**

## Pillar "Wide-Open Plugin Ecosystem"

**v6.5.0 — shipped.**
- A richer plugin API, fully additive: `createCardFromData` (insert any card type, not just one a plugin registered itself — what makes a template importer possible at all), `shareCardToBoard`/`unlinkSharedCard` (v6.4.0's shared-cards mechanism, now plugin-reachable), `showToast`/`showConfirmDialog` (so a plugin's own UI matches Kanvaz's instead of reinventing it), and the community-templates catalog fetchers. `kanvazApiVersion` deliberately stays at `1` — it's an exact-match gate for a real breaking change (see `plugin-loader.js`), not a feature counter, same precedent 4.3.0 already set; every existing plugin (`theme-creator`, `mcp-bridge`) keeps working completely unchanged.
- `docs/PLUGIN_AUTHORING.md` rewritten with all of the above plus an explicit, considered "Selling your plugin" section: yes, sell it wherever you want, at whatever price — Kanvaz will never add in-app payments or a marketplace (would put a solo-maintained project on the hook for refunds/fraud/tax forever), and a real constraint is disclosed rather than glossed over (a plugin's own network calls are subject to the same page-wide CSP as Kanvaz's own renderer, so a phone-home license check won't work — sell it as a one-time download instead, same trust model as any other paid desktop tool bought off itch.io).
- **Template Maker & Manager**, a new official plugin (`official-plugins/template-maker/`): save the current board as a template, manage your own collection (rename/delete/insert), and browse/install community-submitted ones via a new static `community-templates/catalog.json` in this repo — same free, no-server pattern "Browse Official Plugins" already established, with a PR-based submission process (see `community-templates/README.md`) rather than ongoing manual curation.

## Final phase — UI polish

**v6.6.0 — shipped. The v6.x arc is complete.** A full pass over every screen/control added by this whole arc, checked for CSS-variable usage (theme correctness), spacing/typography consistency, and hover/transition parity with equivalent existing controls. Result: the arc held up well — a repo-wide sweep for a raw hardcoded color outside an actual color-picker/swatch context found exactly one hit (a toggle switch missing its transition animation), fixed. See `CHANGELOG.md`'s 6.6.0 entry for the full audit writeup, including the one standing disclosed gap (no interactive Playwright/`_electron` driver exists for this project — every verification this whole arc did was a code audit plus a boot-test, never a live click-through).

**All three pillars — Live Reference, Never Lose Anything Again, Wide-Open Plugin Ecosystem — are shipped, tested, and documented.** This is the plan (see the top of this section) reaching its stated end.

**v6.6.1/v6.6.2 — real bugs slipped through even this polish pass.** A user reported Reference Mode throwing an error right after v6.6.0 shipped — it turned out the whole feature had been non-functional via its own button/shortcut/palette entry points since v6.0.0 (a scoping mistake: its code lived in the wrong internal module). Fixing that (v6.6.1) left one stale reference behind, breaking the Escape-key exit from click-through too — badly enough that a user could get stuck unable to click or close the app (v6.6.2). Both found and fixed via a real live reproduction against the running app over the Chrome DevTools Protocol, not a static read-through — see `CHANGELOG.md`'s 6.6.1/6.6.2 entries. The lesson stands exactly as disclosed throughout this arc: a boot-test is not the same as clicking the button, and it's now a standing requirement for the v7.x line below, not just this arc's own retrospective.

---

# The v7.x line — side-project continuation

*Opened 2026-09-13.* The v6.x arc's "genuinely done" framing (v6.6.0–v6.6.2) stands as an honest record of that decision — this isn't walking it back. The user has chosen to keep developing Kanvaz anyway, explicitly as a side project now rather than the main focus: "we will keep adding things to Kanvaz, keep developing it with feedback and new ideas." No fixed deadline, no "final arc" framing this time — ship items below whenever there's time, in whatever order makes sense, driven by real feedback as it comes in (like the Reference Mode bugs were). This section is the plan for a specific batch of feedback the user gave on 2026-09-13; it isn't a promise this is the last batch.

## Items, roughly in suggested order

1. **Resize modifier-key semantics — v7.0.0, shipped.** Swapped to match convention: free resize by default, Shift locks proportions (was backwards — aspect-locked by default, Shift freed it). Disclosed as a deliberate behavior change, same discipline as v6.3.0's `alwaysOnTop` default flip. Also found and fixed a real related bug: the aspect-lock exclusion for note/audio/url/file/text cards was only checked in one of two code paths in `startResize()`, so those types could still get corner-aspect-locked despite the exclusion. Verified live via CDP-simulated mouse drags (see `CHANGELOG.md`'s 7.0.0 entry), not just a static read.

2. **Video/audio control polish — v7.0.0, mostly shipped.** Play/pause and frame-step/onion-skin icons redrawn onto the same 16x16 viewBox grid the mute/loop icons already used (previously mixed 10x10/14x14, visibly inconsistent sizing in the same toolbar). Added a real per-card volume level slider (0–1, persisted), not just mute on/off. **Not done yet**: a small expand/fullscreen affordance — still open, low priority, fold into a future pass.

3. **PDF preview for file-reference cards.** Right now a `file` card is icon + filename + Open/Change buttons — no content preview at all. This is also literally the file-ref ask: "should show a screen where the doc is able to scroll, zoom, and the card itself can be resized." Plan: **PDF.js** (pure JS, same "no native binaries" bar `wink-nlp` was chosen against) for `.pdf` specifically — gives real scroll + zoom + pagination inside the existing resizable card frame for free. Every other file type (zip, exe, unrecognized binaries) has nothing sensible to preview and keeps today's icon-only card — this is scoped to PDF, not "make every file type previewable."

4. **Annotation tool upgrade — the biggest item on this list.** Current tools: pen, arrow, rectangle, measure, eyedropper; fixed color swatches; fixed width presets. To close the gap with Figma-level annotation:
   - Ellipse and straight-line tools (rect/arrow already exist, these are the clear gaps)
   - A text tool on the annotation layer itself (distinct from the existing Text *card* type — this stamps a label onto an image/video, not a floating card)
   - Highlighter (thick, semi-transparent stroke)
   - Custom color picker + a recent-colors row, replacing the fixed swatch-only palette
   - Per-stroke opacity
   - **Select, move, and delete an individual existing stroke** — today, once a stroke is drawn, the only way to change anything is "Clear annotations" (nukes everything) or undo (rolls back the whole board's last action, not stroke-scoped). This is the single biggest quality-of-life gap versus Figma and the part of this item that actually touches the stroke data model, not just adds new draw tools — plan this one as its own dedicated pass rather than folding it into the same release as the new tools above.

5. **3D model preview.** New card type (`model3d`), same architectural pattern `image`/`video`/`audio` already use in `media.js`/`cards.js`. **Three.js** — pure JS + WebGL, no native binaries, fits the exact bar `wink-nlp` was chosen against. Format support, realistically:
   - `.glb`/`.gltf` — solid via `GLTFLoader`, ship first
   - `.obj`+`.mtl` — doable via `OBJLoader`, second
   - `.fbx` — `FBXLoader` exists but is the least reliable of the three against real-world exports; disclose as "best effort," not a firm commitment
   Controls for v1: orbit-rotate/pan/zoom (mouse-drag, consistent with how the canvas itself already works), a wireframe toggle, a background-color swatch — not a full material/lighting inspector. Real cost to flag: Three.js + loaders add meaningful bundle weight (600KB+), unlike every dependency chosen so far this arc — worth it, just not free the way `wink-nlp`'s ~4.5MB was framed as "small."

6. **Additional supported formats, lower priority than the above.** Given Kanvaz's VFX/3D audience specifically:
   - **Fonts** (`.ttf`/`.otf`) — sample-text preview, cheap to build
   - **HDRI/EXR** — genuinely on-brand for lighting/reference HDRIs, needs a pure-JS EXR decoder plus exposure/tone-map controls; meaningfully bigger lift than fonts or PDF
   - Markdown/code file preview — moderate value, low cost, not requested directly but a natural extension of the PDF-preview work in item 3

7. **General UI polish** — explicitly "not blocking but great to have" per the user's own framing. No fixed scope yet; revisit after the items above land, the same way v6.6.0's polish pass happened after its pillars were functionally complete rather than alongside them.

## Standing constraints carried forward

Same discipline as the whole v6.x arc: no native dependencies without a real audit first (`npm view <pkg> dependencies`, check for `.node` files) — Three.js and PDF.js both need this check confirmed at implementation time, not just assumed from their reputation as "pure JS" libraries. 100% offline core stays non-negotiable; none of the above touches the network. Every release still gets CHANGELOG.md/docs/HANDOFF.md/SECURITY.md updated, and real live verification (the CDP-driven technique from v6.6.1/6.6.2, not just a boot-test) before calling anything done — that lesson from this exact arc's own bugs stands as a hard requirement going forward, not a suggestion.

---

## Not a version, flagged so it doesn't get lost

The website update has been explicitly held off multiple times — release/CHANGELOG work first, website is a separate deliberate joint step. With development now closed out at v5.3.0, this is unscoped future work if the user chooses to pursue it — not part of the app's own release cadence.

Full per-plugin process isolation remains explicitly declined (multi-week rearchitect, not worth it against the current plugin ecosystem size) — logged as deliberate future work in `SECURITY.md`, not a gap anyone missed. With development closed out, this stays declined; it isn't something a GitHub issue against this repo should expect to reopen.

~~Free template gallery — raised mid-session, not yet scoped.~~ **Done, shipped in v5.1.0.** Scoped as an in-app "Start from Template" button (not a website/landing-page play) with 3 bundled starter boards — see `CHANGELOG.md`'s v5.1.0 entry.
