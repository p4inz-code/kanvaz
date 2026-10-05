# Releasing Kanvaz

How to cut a release so a second person can do it without the original maintainer. Every step here was checked against the real files in this repo on 2026-10-04 (`package.json`, `.github/workflows/build.yml`, `test/validate.js`, `.github/release-download-guide.md`) and against the live v9.7.0 release. Steps that could **not** be tested are marked **(untested)**.

## What a release is

A release is a git tag `vX.Y.Z` pushed to `p4inz-code/kanvaz`. GitHub Actions (`.github/workflows/build.yml`) does the rest: validates, creates a **draft** GitHub release with notes pulled from `CHANGELOG.md`, builds Windows, macOS and Linux installers on native runners, uploads them to that draft, then verifies the uploaded files. A human then publishes the draft. Nothing is published automatically.

"Shipped" means the release shows `draft:false` and **Latest**. A pushed tag is not shipped.

## Access a second person needs

- **Write access to the repo.** Today the owner (`p4inz-code`) is the only collaborator, so this must be granted first. The owner runs, with the new person's GitHub username:

  ```bash
  gh api -X PUT repos/p4inz-code/kanvaz/collaborators/<username> -f permission=push
  ```

  (That command was not run; it is the documented GitHub API call.) The person accepts the emailed invitation. `push` is enough for everything in this document (pushing `main`, pushing tags, editing releases, re-running workflows). It does not give admin, so they cannot change repo settings or Pages. Separately, the owner can name a successor for the GitHub account itself under GitHub account settings, which is the only provision for the account being unavailable.
- **`gh` CLI**, authenticated, and Node 20 (CI uses Node 20).
- **No secrets.** `gh secret list` is empty. CI uses only the built-in `GITHUB_TOKEN`.
- **No signing certificates.** Installers are deliberately unsigned (owner decision). Windows SmartScreen and macOS Gatekeeper warnings are expected and documented in the README and the release notes. Do not add signing.

## Before you start

1. Work on `main` with a clean tree. Check `git status`.
2. Releases are cut by pushing a tag and letting CI build. There is no local ship script: the old `ship.bat` and `test/version-check.js` (last touched at v3.7.2, failing on the current repo, and running `git add -A`) were deleted on 2026-10-04. `npm run validate` section 10 is the version check.
3. `upi-qr.jpeg`, `download.jpe` and `docs/handoff-assets/donate-rollout/` are personal files that must never be committed. They are in `.gitignore` as of 2026-10-04, but still stage files by name rather than `git add -A`.

## Steps

### 1. Bump the version

The version must match in these places. `npm run validate` (section 10) enforces the first three:

- `package.json` → `"version"`
- `src/boards.js` → `var VERSION = 'X.Y.Z'`
- `README.md` → the build filenames that contain the version
- `package-lock.json` → keep in sync with `npm install --package-lock-only` (nothing checks it, and it was found stale at 8.9.8 on a 9.7.0 tree)
- `docs/Kanvaz_Overview.pdf` → regenerate with `python docs/generate_overview_pdf.py` (needs `pip install reportlab`); it reads the version from `package.json`, and `test/doc-assets-test.js` fails if the PDF's version is stale
- `docs/index.html` stats strip (Source Modules is checked by the same test; the Releases count is not, so recount it with `gh release list --limit 300 | wc -l`)

The About screen reads the version from `KanvazBoards.getVersion()`, so there is nothing to edit in `ui.js`.

If installer file naming ever changes, update `.github/release-download-guide.md` too (see step 6).

### 2. Write the CHANGELOG entry

Turn the `## [Unreleased]` content into a new section directly under it, with **exactly** this heading shape (em dashes, not hyphens):

```
## [X.Y.Z] — YYYY-MM-DD — short summary of the release
```

CI depends on this. It extracts everything from that heading to the next `## [` heading as the release notes, and it parses the summary out of the heading for the release title (`X.Y.Z — summary`). If the section is missing, or the heading cannot be parsed, the `create-release` job fails on purpose rather than shipping an undescribed release. Leave a fresh empty `## [Unreleased]` above it.

### 3. Run the checks locally

```bash
npm run lint
npm run validate
npm audit --audit-level=high
```

All three must pass. `lint` currently reports 5 known warnings and 0 errors. The audit gate is blocking: a newly published advisory on a build dependency can turn CI red with no code change. The fix is a lockfile bump (`npm audit fix --package-lock-only`), not loosening the gate (this happened on 2026-10-04).

### 4. Commit, push, wait for green

Commit the bump with named files, push `main`, and wait for the **Build** workflow's `Validate` job to pass (`gh run list`).

### 5. Tag and push

```bash
git tag -a vX.Y.Z -m "vX.Y.Z — short summary"
git push origin vX.Y.Z
```

The tag run does, in order: `validate` → `create-release` (draft with notes and the download guide) → `build` for Windows, macOS, Linux (one at a time) → `verify-release`. v9.7.0's tag run took about 4m36s before `verify-release` existed.

### 6. Do NOT run `gh release create`

Read the long comment at the top of `build.yml`. If a release for the tag already exists **published**, electron-builder silently skips uploading every installer while the workflow still shows green. That is how 8 releases (v7.14.0 to v7.21.0) shipped with no installers. The workflow's own `create-release` job makes the draft; never create one by hand.

### 7. Confirm the draft before publishing

```bash
gh run watch            # or: gh run list, wait for the tag run
gh release view vX.Y.Z --json isDraft,assets --jq '.isDraft, (.assets[] | .name)'
```

The draft must have these assets (the `verify-release` job checks all of it):

| Platform | Asset |
|---|---|
| Windows | `Kanvaz-Setup-X.Y.Z.exe` (installer), `Kanvaz-X.Y.Z.exe` (portable) |
| macOS Apple Silicon | `Kanvaz-X.Y.Z-arm64.dmg` |
| macOS Intel | `Kanvaz-X.Y.Z.dmg` (no `-x64` in the name) |
| Linux | `Kanvaz-X.Y.Z.AppImage` |
| Update metadata | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, and `*.blockmap` files |
| Checksums | `SHA256SUMS-windows-latest.txt`, `SHA256SUMS-macos-latest.txt`, `SHA256SUMS-ubuntu-latest.txt` |
| Plugins | one `kanvaz-<plugin>-X.Y.Z.zip` per folder in `official-plugins/` |

`verify-release` (`tools/verify-release.js`) fails the tag run if: a required asset is missing; a filename the download guide names is not a real asset; a checksum line names a non-asset or its hash does not match the real file; an installer is zero bytes or has no checksum line; or the tag has more than one release or a stray `untagged-*` draft. It only reads. A red result means "do not publish yet".

**(untested)** The `verify-release` job has not run on GitHub yet (it was added after v9.7.0). Its checks were run locally against the real downloaded v9.7.0 assets and pass. The one assumption that could not be exercised offline is that `gh release download <tag>` can fetch a *draft* with the Actions token. If that step fails with "release not found", run the verifier by hand:

```bash
mkdir assets && gh release download vX.Y.Z --dir assets
gh release list --limit 100 --json tagName,isDraft > releases.json
node tools/verify-release.js assets X.Y.Z --releases releases.json --tag vX.Y.Z
```

You can also download and launch the installers from the draft yourself before publishing; nothing in CI starts the built app.

### 8. Official-plugin catalog (after publishing)

`official-plugins/catalog.json` is read **live from `main`** by the app's "Browse Official Plugins" screen, and each `downloadUrl` is pinned to a specific release asset. CI builds fresh plugin zips for every tag but cannot update the catalog, because the asset URL only works once the release is published. It silently went stale for years (by v9.7.0 it still served v7.0.0 zips and did not list AI Export); it was brought current on 2026-10-04.

The tag run now tells you when it needs updating: `verify-release` compares each plugin zip in the draft with the catalog and prints a `::warning::` (shown on the workflow run page) for a stale version, an unlisted plugin, or permissions that differ from what users would be shown. Each warning includes the exact `version` and `downloadUrl` to set. These are warnings, not failures, because an unchanged plugin is legitimately fine.

After step 9, edit the entries it named: set `version` and `downloadUrl` as the warning says, and keep `description`, `permissions` and `author` identical to the plugin's `plugin.json`, push, and spot-check each URL returns 200:

```bash
curl -sIL -o /dev/null -w "%{http_code}
" https://github.com/p4inz-code/kanvaz/releases/download/vX.Y.Z/kanvaz-<plugin>-X.Y.Z.zip
```

Editing this file changes what already-installed copies of Kanvaz offer, immediately, so do it only after the release is public. The install itself (download, extract, consent prompt) uses native dialogs and could not be driven or tested offline.

### 9. Publish

```bash
gh release edit vX.Y.Z --draft=false --latest
gh release list -L 3
```

The new release must show **Latest**. Publishing makes the update metadata (`latest*.yml`) visible, so installed copies of Kanvaz start offering the update. Only after this is the release shipped.

### 10. Afterwards

- Update `CHANGELOG.md`, `docs/HANDOFF.md` or a new `docs/SESSION_HANDOFF_<date>.md`, and `SECURITY.md` if trust boundaries changed. This is done on every release, with no exceptions.
- The landing page and README stats (module count, release count) must be recounted from the repo, not copied from older text.
- GitHub Pages rebuilds from `main:/docs` on every push. It caches for minutes, so append `?v=<commit>` to a URL when checking a fresh push.

## Replacing an asset on an already-published release (rare, done once on 2026-10-05)

Use this only when a published release has a bad installer and the owner does not want a new version number. It is untidy by design; prefer a new patch release.

**Do not move or re-push the tag.** Re-running CI on an already-published release makes electron-builder silently skip the installer upload (the trap described at the top of `build.yml`), but the plugin-zip and checksum steps still run with `--clobber`, leaving checksums that describe installers that were never uploaded, and `verify-release` goes red.

1. Commit and push the fix to `main` and wait for CI.
2. Back up the files you will replace: `gh release download vX.Y.Z -p <name> -D <backup dir>` (keep it outside the repo).
3. Build in a **fresh clone** of that commit (`git clone`, `git checkout <sha>`, `npm ci`, `npm run build:win -- --publish never` with `CSC_IDENTITY_AUTO_DISCOVERY=false`), not in the dev checkout, so `node_modules` matches CI. Confirm with `Get-AuthenticodeSignature` that it is unsigned like the CI build.
4. Names: copy `Kanvaz Setup X.Y.Z.exe` to `Kanvaz-Setup-X.Y.Z.exe` (and the `.blockmap`). electron-builder already writes dashed names into `latest.yml`; check that its `sha512` and `size` equal `openssl dgst -sha512 -binary <exe> | base64` and `stat`. In `SHA256SUMS-windows-latest.txt` replace only the changed line, in the same `<hash> *<name>` format.
5. Upload with `gh release upload vX.Y.Z <exe> <blockmap> <sums> --clobber`, then `latest.yml` **last**, so no updater ever reads new metadata before the new installer exists.
6. Re-download all assets and run `node tools/verify-release.js <dir> X.Y.Z --releases <json> --tag vX.Y.Z`. To prove a change is really in the installer, extract it (full 7-Zip: `7z x -tNsis`) and compare files under `$PLUGINSDIR`.
7. Record in the CHANGELOG that the tag no longer matches the rebuilt asset byte for byte.

Clients that already downloaded the old build will fail the sha512 check once and retry; nobody ends up with a corrupted install.

## When something goes wrong

| Symptom | What it means / what to do |
|---|---|
| `Validate` fails at `npm audit` | New advisory. `npm audit fix --package-lock-only`, re-run lint/validate, push. |
| `create-release` fails: "No CHANGELOG.md section found" | Heading missing or not `## [X.Y.Z] — date — summary` with em dashes. Fix the heading, retag per below. |
| One build leg red | `fail-fast` is off, so the others still finish. `gh run rerun <run-id> --failed`. `create-release` is idempotent and later steps only add assets to the one existing draft. **(untested for a re-run)** Always finish with `verify-release`. |
| Two drafts for one tag | The v9.6.0 incident. `verify-release` reports it. Keep the draft holding all installers, delete the other with `gh release delete`, and confirm which is which with `gh release view` first. |
| Release published before CI built | Installers were silently skipped (the 8-release incident). Do not rely on a fix from memory: re-read the header comment in `build.yml` and test on a throwaway tag first. |
| Tag pushed with a bad heading or wrong content | Delete the tag and draft, fix, retag. Destructive and public: check `gh release view` and confirm the release is still a draft first. |

## What cannot be handed over by this document

- The owner's GitHub account, 2FA, and repository admin rights.
- Anything in the untracked donate/QR files, which are personal and never go in the repo.
