# Maintenance plan, 2026-10-04

Scope: the CI failure on `028e766`, the shared-drive overwrite warning, CI-gated
release-asset verification, and a release/bus-factor doc. (Strata was dropped from
consideration by the owner the same day.)

Order: plan -> self-audit of the plan -> fixes folded in below -> build.

## 0. CI failure (run 37202960277)

Cause: `npm audit --audit-level=high` flagged `http-cache-semantics <=4.2.0`
(GHSA-ch52-4w7c-c8xp), published after the previous green run. It arrives via
`electron-builder -> app-builder-lib -> @electron/get -> got -> cacheable-request`.
Build tooling only: it is not in the shipped app. The code in the failing commit
was docs only; lint and validate both passed in that run.

Fix: lockfile-only bump to `http-cache-semantics@4.3.0` (`npm audit fix
--package-lock-only`). Verified locally: `npm audit` reports 0 vulnerabilities.
Side effect: the lockfile's own version string moves 8.9.8 -> 9.7.0 (it had been stale).

Keep the audit gate blocking (the owner chose that when it reached 0 findings).
Known cost: a newly published advisory can turn `main` red with no code change.
The remedy is a lockfile bump, not loosening the gate.

## 1. Shared-drive silent overwrite warning

Confirmed gap: `boards.js` uses `mtimeMs` only for the "3 hours ago" label.
`file-write` in `main.js` never looks at what is on disk.

Design (check happens in the main process, where the stat is authoritative):

- New pure module `src/save-guard.js` (Node-only, ES5, no electron require, like
  `path-guard.js`): `isConflict(expectedMtimeMs, diskMtimeMs)`.
  - No expectation (null/undefined) -> never a conflict (Save As, first save).
  - Disk file missing -> never a conflict (it was deleted; writing recreates it).
  - Tolerance of 2000 ms, because FAT/exFAT and some SMB/NAS stacks round
    mtimes to 2 s, and a write we made ourselves must not read back as foreign.
- `file-read` additionally returns `mtimeMs` from a `stat` of the same path.
- `file-write(path, data, opts)`: `opts.expectedMtimeMs` and `opts.force`.
  Before writing, stat the target. On conflict and not `force`, return
  `{ ok:false, conflict:true, diskMtimeMs }` and write nothing. On success, stat
  the final path and return `{ ok:true, mtimeMs }`.
- Renderer (`boards.js`): remember `loadedMtimeMs` for `currentPath`. Set on open,
  refreshed after every successful write, cleared whenever `currentPath` is
  replaced by a path we did not just read. Plain Save / autosave-to-file path /
  `saveBoardToPath` send it. `saveBoardAs` sends none.
- On conflict the user gets a dialog: **Overwrite** (resend with `force`),
  **Save As copy** (existing Save As flow), **Cancel** (stay dirty, nothing lost).
  The plugin/MCP `saveBoardToPath` path must not hang on a dialog: it resolves
  `{ ok:false, conflict:true, error:... }` instead, and the human decides in the UI.
- Autosave writes only the recovery file, never `currentPath`, so it is
  unaffected. Verify that, do not assume it.

Limits to state honestly, not hide:
- Stat-then-rename is not atomic. Two saves landing in the same instant can
  still race. This catches the realistic case (saved minutes apart from two
  machines), not a true simultaneous write. A lock file is out of scope.
- It detects "a different save happened", not content. A touch with no change
  also triggers the dialog. Acceptable: one extra click, no data loss.

Tests:
- `test/save-guard-test.js`: unit tests for `isConflict` (within tolerance, beyond
  tolerance, missing file, null expectation) and an fs-level test of the stat
  logic against real temp files with `utimes`-forged mtimes.
- `validate.js` section: static guard that `file-write` still consults the guard
  and `boards.js` still sends `expectedMtimeMs` (same style as 9e).
- Live (human, owner offline): two Kanvaz profiles, one `.kanvaz` on a shared
  folder, save from A then B. Not drivable over CDP because the board path is
  granted via a native dialog. This will be reported as NOT live-verified.

## 2. CI-gated release-asset verification

Problem class: two releases shipped with wrong names or missing installers
(filenames in the guide, checksum names, 8 releases with no installers). The
checksum step is `continue-on-error: true`, so a broken one is invisible.

Design: new job `verify-release` in `build.yml`, `needs: build`, tag pushes only,
`contents: read` plus a token that can read the draft.

- Download every asset of the draft (`gh release download <tag> -D assets`).
- Run `tools/verify-release.js <dir> <version>`, a dependency-free Node script:
  1. Required set exists exactly: `Kanvaz-Setup-V.exe`, `Kanvaz-V.exe`,
     `Kanvaz-V-arm64.dmg`, `Kanvaz-V.dmg`, `Kanvaz-V.AppImage`, `latest.yml`,
     `latest-mac.yml`, `latest-linux.yml`, three `SHA256SUMS-*.txt`, one
     `kanvaz-<dir>-V.zip` per directory in `official-plugins/`.
  2. Every filename the download guide backticks (after `<version>` substitution,
     wildcard rows skipped) is a real asset. This is the exact bug found in 9.7.0.
  3. Every `SHA256SUMS-*.txt` line names an existing asset and its SHA-256
     matches (computed with Node `crypto`, so it behaves the same on any runner).
  4. No installer is zero bytes.
  5. Exactly one release per tag (catches the 9.6.0 duplicate-draft incident).
- Failure blocks the owner from publishing only by being a red check on the tag;
  it does not auto-publish or auto-delete anything.

The script is separate from the workflow so it can be run locally against the
real v9.7.0 assets, which is the live check available offline.

## 3. Release / bus-factor doc

`docs/RELEASING.md`: the exact procedure a second person follows, written from
the real files (`ship.bat`, `build.yml` header, `release-download-guide.md`,
`validate.js` version checks), not from memory:
what files carry the version, the CHANGELOG heading format CI parses for the
title, tag + push, wait for the draft (never `gh release create` first), run the
verification job, publish with `--draft=false`, confirm Latest, what to do when
the audit gate or a build leg fails, and what is NOT possible to hand over
(accounts, secrets, the donate files). It must not claim steps that were not
checked against the repo.

## Order of work and release

1. Lockfile fix (done) and recheck `npm run lint` / `npm run validate`.
2. Item 1 code + tests.
3. Item 2 script + workflow job, run against real v9.7.0 assets.
4. Item 3 doc.
5. CHANGELOG `[Unreleased]` entries for each; commit in separate commits.
6. Push only after lint + validate pass. No version bump and no release: these are
   unreleased changes on `main`, consistent with the standing "ship = draft:false"
   rule, so nothing is called shipped.
7. Never stage `upi-qr.jpeg`, `download.jpe`, `docs/handoff-assets/donate-rollout/`.

## Plan audit (checked against the real code) and what changed

1. **Check placement was wrong.** The plan stat-checked before `packBoard`. Packing a
   large board takes seconds, so the race window was seconds wide. Fixed: write the
   `.tmp` first, then stat-and-compare immediately before `rename`; on conflict delete
   the `.tmp` and leave the real file untouched. Window shrinks to one stat to rename.
2. **Callers.** `grep` confirms only `boards.js` calls `readFile`/`writeFile`
   (lines 1184, 1273, 1326), so the extra `mtimeMs` field and the optional third
   argument cannot break plugins or other modules.
3. **Close-flow hang risk.** `handleCloseRequest` and `confirmDiscardIfDirty` pass an
   `onDone` into `saveBoard`. Every conflict branch must call `onDone(false)` (or the
   forced write's real result) exactly once, so closing never hangs and never
   discards. Overwrite -> result of forced write; Cancel and Save-As-copy -> `false`.
4. **Clock skew is a non-issue.** Both mtimes come from the same file on the same
   filesystem, so client/server clock difference does not matter. Recording that so
   nobody "fixes" it later.
5. **Item 2 gaps.** (a) The "one release per tag" check also has to flag any draft whose
   tag starts with `untagged-`, because the 9.6.0 duplicate looked like that. (b) A
   draft is only visible to a token with push access, so the job needs
   `contents: write`; it only reads. This cannot be exercised offline, so the first real
   tag run is the first real test of that job and must be reported that way.
   (c) Guide parsing must ignore wildcard (`*`) entries and tokens without a file
   extension (for example the `-x64` aside), or it false-fails.
6. **Release stays untouched.** No version bump and no tag. The new job only runs on
   tag pushes, so it cannot be seen running until the next real release.
