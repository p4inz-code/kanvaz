# The Full Audit Suite

This is what runs whenever you say **"run full suite"** (or "run the full
audit," "do the full pass," etc.) — a standing, repeatable definition so
neither of us has to re-negotiate scope each time. It's the same discipline
this project has already used release after release (3D preview, the
post-3D bug bounty, the Reference Mode removal, the icon overhaul) — this
document just writes it down properly instead of re-deriving it from memory
every time.

Run it before any release you're calling "done" in a real sense — not
necessarily every single patch, but definitely before a version bump that
closes out a feature arc (a flagship feature, a redesign phase, anything
you'd call a milestone).

## 1. Static checks (fast, always first)

- `node test/lint.js` — 0 errors required (warnings reviewed, not
  necessarily blocking if they're pre-existing/known).
- `node test/validate.js` — all sections must pass clean. This already
  covers syntax across every file, the board container format round trip,
  plugin loader validation, the command registry, MCP Bridge end-to-end,
  plugin permission scoping, undo history integrity, PureRef import,
  Smart Search, shared cards, and version-string consistency across all
  six canonical locations.

If either fails, fix before proceeding to anything below — no point
auditing code that doesn't even pass its own baseline.

## 2. Fresh app-wide bug bounty (parallel agents)

Launch background agents (`Agent` tool, `general-purpose`, high
confidence bar) covering areas NOT already scrutinized in the current
release cycle. Each agent gets:
- A specific file/subsystem assignment (not "review everything" — that
  produces shallow, generic findings).
- Explicit instruction: only report concrete, reproducible findings with
  file:line, a one-sentence summary, and a specific failure scenario.
  No style preferences, no "could be improved" vagueness.
- A cap (e.g. 10 findings, ranked most severe first).

Rotate coverage release to release — don't re-audit the same files every
time; track what's already been covered in `docs/HANDOFF.md`'s per-version
notes and aim at what hasn't.

Every CONFIRMED finding gets fixed and verified before the release ships,
not just logged. A finding that turns out REFUTED on closer inspection
gets recorded as such (see the registerTheme/dispatchEvent example in
`SECURITY.md`) so a future pass doesn't re-chase it.

## 3. Live verification via CDP (never trust static review alone)

This project's own history has repeatedly found real bugs that pure code
reading missed — a button that throws the instant it's actually clicked,
a CSP gap that silently blocks a fetch, a missing vendored file that only
fails when actually imported. Static review is necessary, not sufficient.

Standard technique:
1. Launch the packaged app with remote debugging:
   `./node_modules/electron/dist/electron.exe --remote-debugging-port=NNNN .`
2. `curl http://127.0.0.1:NNNN/json/list` for the `webSocketDebuggerUrl`.
3. A small Node script using the `ws` package (already a project
   dependency) sends raw CDP protocol messages — `Runtime.enable`,
   `Console.enable`, `Runtime.evaluate` (`returnByValue:true`),
   `Input.dispatchMouseEvent`/`dispatchKeyEvent`, `Page.captureScreenshot`
   for visual verification — to drive and observe the real running app.
4. **Always fully quit the previous instance first** (`taskkill //IM
   electron.exe //F` on Windows) before relaunching — this app uses
   `app.requestSingleInstanceLock()`, so a "new" launch without killing
   the old one just focuses the existing window instead of giving you a
   fresh process, silently invalidating whatever you're trying to verify
   fresh (module-cache state, a code change that needs a real reload).
5. Known CDP limitation: `Input.dispatchKeyEvent` doesn't reliably route
   Enter/Escape to a focused `<input>` in this Electron version — dispatch
   a real in-page `KeyboardEvent` via `element.dispatchEvent(...)` inside
   an eval instead when that matters.
6. For visual/layout verification, `Page.captureScreenshot` gives an
   actual screenshot of the running app — more reliable than inferring
   correctness from DOM queries alone for anything CSS/layout-shaped.

Verify: the specific feature/fix actually works when driven like a real
user would (not just "the function exists and returns the right type"),
and zero uncaught exceptions across the whole interaction sequence.

## 4. UI/UX persona-based usability pass

For anything touching user-facing interaction (not needed for a pure
backend/IPC fix), run a live persona-based pass — same CDP technique,
different lens. Standard personas for this app:
- **A professional VFX/3D artist** — realistic fast-moving workflow
  (build a moodboard, annotate, use Reference Mode^ or whatever the
  current equivalent is, try any 3D/media features relevant this cycle).
- **A casual/hobbyist user** — first-run experience, discoverability
  (would they find this feature without being told it exists?), error
  message clarity.
- **A plugin developer** — Settings → Plugins flow, install/browse
  official plugins, developer-facing error messages and console output.

Each persona reports concrete friction (what was done, what happened,
why it's a problem, a specific suggested fix) — not generic advice.

^ Update persona scripts when a referenced feature is removed/changed —
this doc itself should get a quick skim before each run, not treated as
frozen forever.

## 5. Documentation (standing requirement, no exceptions)

Every release that ships out of a full-suite run updates:
- `CHANGELOG.md` — what changed and why, real root-cause writeups for
  bugs, not just "fixed X."
- `docs/HANDOFF.md` — the running context for a future session picking
  this project up cold. Update the "current version" paragraph and add
  any "read this before touching X again" notes a real bug surfaced.
- `docs/ROADMAP.md` — mark shipped items, add anything newly discovered
  during the audit that's worth tracking.
- `SECURITY.md` — any new disclosure needed (new network surface,
  new trust-model implication, a theory investigated and refuted).
- `README.md` — "Latest release" blurb, Features list, Known Limitations,
  Keyboard Shortcuts table if anything changed.

## 6. Version + ship

- Bump version across all six canonical locations (`package.json`,
  `src/boards.js`'s `VERSION`, `src/ui.js`'s About screen — both the
  version line and the tagline — README's build-output filenames).
  `node test/validate.js`'s section 10 catches drift here automatically.
- Commit, tag (`git tag -a vX.Y.Z`), push commit + tag, let CI build,
  publish the GitHub release once CI succeeds (`gh release edit vX.Y.Z
  --draft=false`, `--latest` on the newest one).

## What "run full suite" does NOT mean

A quick bug fix or a single small feature doesn't need all of this —
sections 1 (static checks) and the relevant slice of 3 (live-verify the
specific change) are the baseline for every change, full stop. Sections
2 (fresh bug bounty) and 4 (persona pass) are what "full suite"
specifically adds — reserve those two for milestone releases, not every
commit, or they stop being a meaningful signal and just become overhead.
