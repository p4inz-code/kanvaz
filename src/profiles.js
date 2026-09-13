/* profiles.js — offline multi-profile storage engine (main process only)

   Architecture: docs/PROFILES_SYSTEM_PLAN.md. A profile is a preferences
   PARTITION, not access control (no password, no lock — disclosed in
   SECURITY.md same as the plugin trust model). Each profile owns its own
   settings.json / recent.json / recovery/ under
   userData/profiles/<id>/ — every one of those already existed at the
   userData root before this; this module just relocates them per-profile
   and tracks which one is active.

   Scope note (deliberate, see docs/REDESIGN_V1_SPRINT.md Phase 2): per-
   profile plugin storage/enable-state is NOT part of this slice — plugin-
   loader.js's storage layout is shared, higher-blast-radius surface
   touched by many call sites, and is sequenced as its own follow-up
   rather than bundled in here. Likewise the dedicated "Set up your
   profile" first-run wizard from the plan is not built yet — a fresh
   install auto-creates one profile named from the OS username instead,
   renameable any time via Manage Profiles. Both are known, documented
   reductions in scope, not oversights. */

var fs = require('fs');
var path = require('path');
var os = require('os');

function profilesRoot(userData) { return path.join(userData, 'profiles'); }
function manifestPath(userData) { return path.join(profilesRoot(userData), 'manifest.json'); }
function activePath(userData)   { return path.join(profilesRoot(userData), 'active-profile.json'); }
function profileDir(userData, id) { return path.join(profilesRoot(userData), id); }

function safeUsername() {
  try {
    var name = os.userInfo().username;
    if (name && name.trim()) return name.trim();
  } catch (e) { /* userInfo() can throw on some sandboxed/odd environments */ }
  return 'My Profile';
}

function genId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function readManifest(userData) {
  try {
    var p = manifestPath(userData);
    if (!fs.existsSync(p)) return [];
    var list = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeManifest(userData, list) {
  fs.mkdirSync(profilesRoot(userData), { recursive: true });
  var tmp = manifestPath(userData) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list), 'utf8');
  fs.renameSync(tmp, manifestPath(userData));
}

function readActiveId(userData) {
  try {
    var p = activePath(userData);
    if (!fs.existsSync(p)) return null;
    var data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (data && data.profileId) || null;
  } catch (e) {
    return null;
  }
}

function writeActiveId(userData, id) {
  fs.mkdirSync(profilesRoot(userData), { recursive: true });
  var tmp = activePath(userData) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ profileId: id }), 'utf8');
  fs.renameSync(tmp, activePath(userData));
}

/* `opts.description` is a short free-text line (shown under the name in
   the switcher — "Work", "3D renders", "Kid's account", whatever the
   user wants). `opts.guest` marks a profile created via the "Add Guest
   Profile" quick action in Manage Profiles — purely a label/badge for
   now (rendered with a "Guest" tag), NOT an auto-wipe-on-exit sandbox;
   a guest profile persists its own settings/recents/recovery exactly
   like any other profile, same storage, same isolation. Building an
   actual ephemeral/no-persistence mode is real extra work (what
   exactly gets wiped, and when — on close? on next launch? does it shed
   its OWN recovery file too, defeating crash recovery for that
   session?) and is called out as a follow-up rather than half-built
   here. avatarDataUrl is a small (renderer-downscaled) data: URL, not a
   file path — stored inline in manifest.json since these are guaranteed
   tiny (a resized ~96px avatar), which avoids adding new file-serving
   IPC or loosening index.html's img-src CSP just for this. */
function createProfileEntry(userData, name, opts) {
  opts = opts || {};
  var id = genId();
  fs.mkdirSync(profileDir(userData, id), { recursive: true });
  var entry = {
    id: id,
    name: (name && name.trim()) || safeUsername(),
    description: (opts.description && opts.description.trim()) || '',
    avatarDataUrl: null,
    guest: !!opts.guest,
    createdAt: Date.now()
  };
  var list = readManifest(userData);
  list.push(entry);
  writeManifest(userData, list);
  return entry;
}

/* Renames legacy userData-root files into the new default profile's
   folder. Uses renameSync (a same-volume move, not a copy) — these are
   always under the same userData root, so this never crosses volumes.
   Each file is guarded individually and wrapped in try/catch: a partial
   failure on one (e.g. recovery/ locked by another process) must not
   abort the others or leave migration half-finished with no manifest at
   all — every guarded rename is independently safe to skip and retry
   on a later launch, since ensureMigrated() only ever runs once
   manifest.json exists, and it's written last. */
function migrateLegacyInto(userData, profileId) {
  var dir = profileDir(userData, profileId);
  var moves = [
    [path.join(userData, 'settings.json'), path.join(dir, 'settings.json')],
    [path.join(userData, 'recent.json'),   path.join(dir, 'recent.json')],
    [path.join(userData, 'recovery'),      path.join(dir, 'recovery')]
  ];
  for (var i = 0; i < moves.length; i++) {
    var from = moves[i][0], to = moves[i][1];
    try {
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.renameSync(from, to);
      }
    } catch (e) {
      /* Leave the legacy file where it was; the profile just starts
         without it (same as any brand-new profile) rather than losing
         the whole migration over one locked/unmovable path. */
    }
  }
}

/* Idempotent — call once at every app startup, before any code computes
   a settings/recent/recovery path. No-ops the instant manifest.json
   exists (that's the only thing this checks), so a second launch never
   re-migrates or re-creates anything. */
function ensureMigrated(userData) {
  if (fs.existsSync(manifestPath(userData))) return;

  var hadLegacyData =
    fs.existsSync(path.join(userData, 'settings.json')) ||
    fs.existsSync(path.join(userData, 'recent.json')) ||
    fs.existsSync(path.join(userData, 'recovery'));

  var entry = createProfileEntry(userData, safeUsername());
  if (hadLegacyData) migrateLegacyInto(userData, entry.id);
  writeActiveId(userData, entry.id);
}

/* Resolves (and self-heals) the active profile's own directory — the
   base path every settings/recent/recovery IPC handler now builds its
   file path from instead of userData directly. Self-heals rather than
   throwing if the active-profile pointer or manifest ever gets out of
   sync (hand-edited, a crashed mid-write, a deleted profile that was
   still marked active) — falling back to "first profile in the
   manifest" and, if the manifest is somehow empty too, creating a fresh
   default profile on the spot, so a single corrupted pointer file can
   never brick the app into an unusable state. */
function getActiveProfileDir(userData) {
  ensureMigrated(userData);
  var list = readManifest(userData);
  if (!list.length) {
    var entry = createProfileEntry(userData, safeUsername());
    writeActiveId(userData, entry.id);
    return profileDir(userData, entry.id);
  }
  var activeId = readActiveId(userData);
  var found = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === activeId) { found = list[i]; break; }
  }
  if (!found) {
    found = list[0];
    writeActiveId(userData, found.id);
  }
  var dir = profileDir(userData, found.id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getActiveProfile(userData) {
  ensureMigrated(userData);
  var list = readManifest(userData);
  var activeId = readActiveId(userData);
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === activeId) return list[i];
  }
  return list[0] || null;
}

function listProfiles(userData) {
  ensureMigrated(userData);
  return readManifest(userData);
}

function createProfile(userData, name, opts) {
  ensureMigrated(userData);
  return createProfileEntry(userData, name, opts);
}

function switchProfile(userData, id) {
  ensureMigrated(userData);
  var list = readManifest(userData);
  var found = false;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) { found = true; break; }
  }
  if (!found) return { ok: false, error: 'no profile with that id' };
  writeActiveId(userData, id);
  return { ok: true };
}

function renameProfile(userData, id, name) {
  ensureMigrated(userData);
  if (!name || !name.trim()) return { ok: false, error: 'name cannot be empty' };
  var list = readManifest(userData);
  var found = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) { found = list[i]; break; }
  }
  if (!found) return { ok: false, error: 'no profile with that id' };
  found.name = name.trim();
  writeManifest(userData, list);
  return { ok: true };
}

/* Merges name/description in one write (the Manage Profiles edit form
   sends both together) — name is optional here (unlike renameProfile,
   which is dedicated single-field rename) so a description-only edit
   doesn't require re-sending the unchanged name. */
function updateProfileMeta(userData, id, fields) {
  ensureMigrated(userData);
  fields = fields || {};
  var list = readManifest(userData);
  var found = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) { found = list[i]; break; }
  }
  if (!found) return { ok: false, error: 'no profile with that id' };
  if (typeof fields.name === 'string') {
    if (!fields.name.trim()) return { ok: false, error: 'name cannot be empty' };
    found.name = fields.name.trim();
  }
  if (typeof fields.description === 'string') {
    found.description = fields.description.trim();
  }
  writeManifest(userData, list);
  return { ok: true };
}

/* dataUrl is a small already-downscaled image (see the createProfileEntry
   comment above on why this is stored inline rather than as a file).
   Pass null to remove the avatar. No size cap enforced here — the
   renderer is the one that resizes before ever calling this, same trust
   split as everywhere else in this app where the renderer prepares data
   and main just persists it. */
function setProfileAvatar(userData, id, dataUrl) {
  ensureMigrated(userData);
  var list = readManifest(userData);
  var found = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) { found = list[i]; break; }
  }
  if (!found) return { ok: false, error: 'no profile with that id' };
  found.avatarDataUrl = dataUrl || null;
  writeManifest(userData, list);
  return { ok: true };
}

function deleteProfile(userData, id) {
  ensureMigrated(userData);
  var list = readManifest(userData);
  if (list.length <= 1) return { ok: false, error: 'cannot delete the only profile' };
  var idx = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return { ok: false, error: 'no profile with that id' };

  var activeId = readActiveId(userData);
  if (activeId === id) {
    return { ok: false, error: 'cannot delete the active profile — switch first' };
  }

  list.splice(idx, 1);
  writeManifest(userData, list);
  try {
    fs.rmSync(profileDir(userData, id), { recursive: true, force: true });
  } catch (e) {
    /* Manifest entry is already gone either way — a leftover folder on
       disk is inert, not a correctness problem. */
  }
  return { ok: true };
}

module.exports = {
  ensureMigrated: ensureMigrated,
  getActiveProfileDir: getActiveProfileDir,
  getActiveProfile: getActiveProfile,
  listProfiles: listProfiles,
  createProfile: createProfile,
  switchProfile: switchProfile,
  renameProfile: renameProfile,
  updateProfileMeta: updateProfileMeta,
  setProfileAvatar: setProfileAvatar,
  deleteProfile: deleteProfile
};
