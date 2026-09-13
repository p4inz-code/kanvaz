# Offline Profiles System — Architecture Plan (plan only, not implemented)

A full local account-equivalent system, entirely offline — no login, no
password, no cloud, no sync between machines. Multiple people (or multiple
personas of one person — "work" vs "testing") can use the same Kanvaz
install on the same computer, each with their own settings, recents, and
identity, fully isolated from each other. This is comparable in scope to
the 3D preview flagship feature — planned as its own release, not folded
into the side-panel redesign as a side effect.

## What a profile owns vs. doesn't own

**Owned per-profile (isolated):**
- Settings (theme, canvas behavior, everything in the reorganized Settings
  panel)
- Recent boards list
- Autosave/crash-recovery file
- Smart Search index (if enabled — a ~4.5MB on-device model + per-board
  index, genuinely something one profile might want and another not)
- Per-plugin storage (a plugin's saved data — e.g. Template Maker's saved
  templates) — profile-scoped, since this is user content/preference, not
  installed-plugin code
- Display name + optional local avatar image

**NOT owned by any profile (shared, machine-wide):**
- `.kanvaz` board files themselves — these are just files on disk,
  openable by any profile, the same way any user account on a shared
  computer can still open any file they have OS permission to read.
  A profile is a preferences partition, not a document-ownership system.
- Installed plugin *code* (the actual plugin files/folders) — installing
  a plugin is a machine-level action; which plugins are *enabled* could
  arguably be per-profile, worth a real decision when this gets built
  (leaning toward per-profile enable/disable, shared install).
- The app itself, licensing, update state — all machine-level as today.

## Storage layout

```
userData/
  profiles/
    manifest.json            ← list of all profiles: [{id, name, avatarPath, createdAt}]
    active-profile.json      ← { profileId: "..." } — which one to load on next launch
    <profile-id>/
      profile.json           ← { id, name, avatarPath, createdAt, lastActiveAt }
      settings.json          ← exactly today's settings.json, just relocated
      recent.json            ← exactly today's recent.json, relocated
      recovery/              ← exactly today's recovery dir, relocated
      plugin-storage/
        <plugin-id>.json     ← per-plugin storage, relocated from its current global location
      smart-search-index/    ← if Smart Search enabled for this profile
      avatar.png             ← optional, user-picked local image (never uploaded anywhere)
```

Every one of these already exists today at the userData root (`settings.json`,
`recent.json`, `recovery/`, per-plugin storage) — this plan relocates them
under a profile folder, it doesn't invent new persistence mechanisms.

## Migration for existing users

On first launch after this ships, an existing single-profile user's current
`settings.json`/`recent.json`/`recovery/`/plugin storage get moved into a
newly-created default profile (name pre-filled from the OS username via
Node's `os.userInfo().username`, editable immediately) — nobody's current
setup resets or vanishes. Same spirit as the existing `SETTINGS_MIGRATIONS`
array in `ui.js`, just operating at the folder level instead of the JSON
schema level.

## UI flow

1. **First run, zero profiles**: a plain "Set up your profile" screen —
   name + optional avatar (native file picker, same trust boundary as any
   other file dialog in this app). No login, no password field exists to
   even consider — pressing Enter with just a name is enough.
2. **Launch with one profile**: goes straight in, no picker — a single-
   profile household shouldn't see any friction at all.
3. **Launch with multiple profiles**: defaults to the last-active profile
   automatically (like Chrome remembering your last profile) rather than
   forcing a picker screen every launch — the corner icon is always there
   to switch if needed. **Decided.**
4. **In-app switcher**: click the corner profile icon → a small menu:
   *Switch profile* (list with avatars), *Manage profiles* (rename/
   delete/create — lives right here, not a separate top-level entry
   point — **decided**), *Edit this profile*, then About/Shortcuts below,
   exactly matching the side-panel plan already agreed.
5. **Start Screen (new, Premiere/Illustrator-style)** — launching Kanvaz
   with no specific file argument (a plain double-click on the app icon,
   Start Menu, taskbar) shows a Home screen first: recent boards (bigger,
   more visual than the current tiny "recent files" list), a prominent
   "New board" action, Kanvaz branding, and — naturally, since it's
   already the first screen the user sees — the profile switcher lives
   here too if more than one profile exists, not just tucked in the
   corner icon. **Skipped entirely** when the app is launched by opening
   a `.kanvaz` file directly (double-click on a board file, "Open with
   Kanvaz", or a second-instance file-open — see `app.on('second-
   instance', ...)` and the `open-file-from-argv` flow already in
   `main.js`) — that goes straight to the board, exactly like today.
   This reuses the existing single-instance/file-argv plumbing to decide
   which path to take; no new IPC surface needed to make that decision.
5. **Switching mid-session with unsaved changes**: reuses the exact
   "Save before closing?" gate the app already shows on window close —
   switching profiles is treated as ending this user session, not a new
   mechanism to build.
6. **Moving a profile to another machine (the offline answer to "sync")**:
   *Export profile* zips the profile folder into a single `.kanvazprofile`
   file; *Import profile* extracts it into a new local profile on the
   target machine. Explicit, user-initiated, zero network — the same
   "portable file, not a stored account" ethos boards already have.

## Explicit disclosure (SECURITY.md-style)

This is **not** access control. No password, no PIN, no lock screen —
anyone with access to the computer can open any profile. It's a
preferences-partitioning convenience (like Windows/Chrome local profiles
without a login wall), not a privacy or security boundary between people
sharing a machine. Worth stating this as plainly as the plugin trust model
is disclosed today, so nobody mistakes "Profiles" for "my board is
protected from whoever else uses this computer."

## Decisions (all resolved)

1. **Plugin enable/disable state** — **per-profile.**
2. **Smart Search index per profile** — **per-profile** (rebuilt on first
   enable per profile, fully isolated, no cross-profile data leakage).
3. **Multi-profile launch behavior** — **auto-load last-active**, no
   forced picker. The new Start Screen (above) is where a picker-like
   experience naturally lives instead, without forcing it on a
   direct-file-open launch.
4. **Where "Manage profiles" lives** — **inside the side panel's Profile
   section**, alongside About/Shortcuts.

No open questions remain — this plan is ready to schedule whenever you
want to build it (after the side-panel/card-visual redesign, per the
sequencing below).

## Suggested sequencing

Given the size, recommend treating this as its own tagged release
(matching how the 3D preview got its own v7.4.0) built and shipped
*after* the side-panel/card-visual redesign lands — the side panel needs
to exist first (it's the UI surface the profile switcher lives in), and
shipping two large architectural changes in one release makes either one
harder to verify live if something breaks.
