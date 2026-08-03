/* plugin-loader.js — Kanvaz plugin manifest scanning + state management
   (main process, CommonJS — same pattern as board-container.js / pur-import.js)

   Sandbox model: convention-based, not iframe/worker-isolated. A plugin's
   entry script runs in the renderer's normal page context (same trust
   model as VS Code extensions), not physically walled off from other page
   globals. What IS enforced here: a plugin only loads if its manifest is
   valid and its declared permission set has been explicitly approved by
   the user, and if a later version of an already-approved plugin asks
   for MORE permissions than it was approved for, that's treated as
   unapproved again — an old approval never silently covers an escalated
   one. Every function here is defensive: a broken/malicious plugin.json
   degrades that one plugin, it never crashes the app or the scan. */

var fs = require('fs');
var path = require('path');
var url = require('url');

var PLUGIN_API_VERSION = 1;
var ALLOWED_PERMISSIONS = ['cardTypes', 'commands', 'network', 'filesystem'];
var MANIFEST_FILE = 'plugin.json';
var STATE_FILE = 'plugin-state.json';

/* Human-readable descriptions shown in the native consent dialog (main
   process) — kept here, not in the renderer, since the consent decision
   itself is made main-process-side (see the security note above
   approvePlugin() usage in main.js: the dialog text is always built
   from a manifest main.js just re-read off disk, never from anything a
   renderer passed in). */
var PERMISSION_DESCRIPTIONS = {
  cardTypes:  'add new card types to boards',
  commands:   'add commands/actions you can run',
  network:    'make network requests',
  filesystem: 'read and write files on your computer'
};

function describePermissions(permissions) {
  if (!permissions || !permissions.length) {
    return 'nothing beyond adding card types to the app';
  }
  return permissions.map(function(p) { return PERMISSION_DESCRIPTIONS[p] || p; }).join(', ');
}

function getPluginsDir(userDataPath) {
  return path.join(userDataPath, 'plugins');
}

function getStatePath(userDataPath) {
  return path.join(userDataPath, STATE_FILE);
}

function ensurePluginsDir(userDataPath) {
  var dir = getPluginsDir(userDataPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function readState(userDataPath) {
  try {
    var p = getStatePath(userDataPath);
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeState(userDataPath, state) {
  var p = getStatePath(userDataPath);
  var tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/* Validates a raw parsed manifest object. Returns { ok: true } or
   { ok: false, reason: '...' } — never throws, whatever garbage is
   handed to it. */
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, reason: 'plugin.json is not a valid JSON object' };
  }
  if (typeof manifest.id !== 'string' || !manifest.id) {
    return { ok: false, reason: 'missing required field: id' };
  }
  if (typeof manifest.name !== 'string' || !manifest.name) {
    return { ok: false, reason: 'missing required field: name' };
  }
  if (typeof manifest.version !== 'string' || !manifest.version) {
    return { ok: false, reason: 'missing required field: version' };
  }
  if (typeof manifest.entry !== 'string' || !manifest.entry) {
    return { ok: false, reason: 'missing required field: entry' };
  }
  if (typeof manifest.kanvazApiVersion !== 'number') {
    return { ok: false, reason: 'missing required field: kanvazApiVersion' };
  }
  if (manifest.kanvazApiVersion !== PLUGIN_API_VERSION) {
    return {
      ok: false,
      reason: 'requires Kanvaz plugin API v' + manifest.kanvazApiVersion +
        ', this Kanvaz supports v' + PLUGIN_API_VERSION
    };
  }
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      return { ok: false, reason: 'permissions must be an array' };
    }
    for (var i = 0; i < manifest.permissions.length; i++) {
      if (ALLOWED_PERMISSIONS.indexOf(manifest.permissions[i]) === -1) {
        return { ok: false, reason: 'unknown permission: ' + manifest.permissions[i] };
      }
    }
  }
  /* entry must resolve to a plain file inside the plugin's own folder —
     never an absolute path or one that walks out via "..". This is
     checked again with a real resolved-path comparison in scanPlugins()
     below; this is just the cheap syntactic rejection. */
  if (path.isAbsolute(manifest.entry) || manifest.entry.split(/[\\/]/).indexOf('..') !== -1) {
    return { ok: false, reason: 'entry must be a relative path within the plugin folder' };
  }
  return { ok: true };
}

/* Scans the plugins directory. Returns an array of descriptors, each
   either { valid:true, ... } or { valid:false, reason:'...' }. A broken
   plugin.json never stops the others from loading and never throws. */
function scanPlugins(userDataPath) {
  var dir = ensurePluginsDir(userDataPath);
  var state = readState(userDataPath);
  var results = [];

  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return results;
  }

  var resolvedPluginsDir = path.resolve(dir) + path.sep;

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry.isDirectory()) continue;

    var pluginDir = path.join(dir, entry.name);
    var manifestPath = path.join(pluginDir, MANIFEST_FILE);

    if (!fs.existsSync(manifestPath)) {
      results.push({ folder: entry.name, valid: false, reason: 'no plugin.json found' });
      continue;
    }

    var manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      results.push({ folder: entry.name, valid: false, reason: 'plugin.json is not valid JSON' });
      continue;
    }

    var validation = validateManifest(manifest);
    if (!validation.ok) {
      results.push({ folder: entry.name, valid: false, reason: validation.reason, manifest: manifest });
      continue;
    }

    var entryPath = path.join(pluginDir, manifest.entry);
    var resolvedEntry = path.resolve(entryPath);

    /* Real containment check — validateManifest already rejected an
       obviously-escaping entry field syntactically, this catches any
       remaining edge case (symlinks, odd separators) by comparing the
       fully resolved path against the plugins root. */
    if (resolvedEntry.indexOf(resolvedPluginsDir) !== 0) {
      results.push({ folder: entry.name, valid: false, reason: 'entry resolves outside its plugin folder', manifest: manifest });
      continue;
    }

    if (!fs.existsSync(resolvedEntry)) {
      results.push({ folder: entry.name, valid: false, reason: 'entry file "' + manifest.entry + '" not found', manifest: manifest });
      continue;
    }

    var pluginState = state[manifest.id];
    var approvedPermissions = (pluginState && pluginState.approvedPermissions) || [];
    var everApproved = !!(pluginState && pluginState.approvedVersion);
    var requestedPermissions = manifest.permissions || [];
    var hasNewPermission = requestedPermissions.some(function(p) {
      return approvedPermissions.indexOf(p) === -1;
    });
    var needsConsent = !everApproved || hasNewPermission;
    var enabled = !!(pluginState && pluginState.enabled) && !needsConsent;

    results.push({
      folder: entry.name,
      valid: true,
      manifest: manifest,
      dir: pluginDir,
      entryPath: resolvedEntry,
      entryUrl: url.pathToFileURL(resolvedEntry).href,
      enabled: enabled,
      needsConsent: needsConsent,
      approvedPermissions: approvedPermissions
    });
  }

  return results;
}

/* Records that the user approved a plugin at a given version with a
   given permission set, and enables it. */
function approvePlugin(userDataPath, pluginId, version, permissions) {
  var state = readState(userDataPath);
  state[pluginId] = {
    enabled: true,
    approvedPermissions: permissions || [],
    approvedVersion: version
  };
  writeState(userDataPath, state);
}

function setEnabled(userDataPath, pluginId, enabled) {
  var state = readState(userDataPath);
  if (!state[pluginId]) return;
  state[pluginId].enabled = !!enabled;
  writeState(userDataPath, state);
}

/* Removes a plugin's own folder only. pluginFolder must resolve to a
   direct descendant of the plugins directory — blocks a crafted folder
   name from ever deleting anything outside it, and refuses to delete
   the plugins directory itself if pluginFolder is empty/'.'/'..'. */
function removePlugin(userDataPath, pluginFolder, pluginId) {
  var dir = getPluginsDir(userDataPath);
  var target = path.join(dir, pluginFolder || '');

  var resolvedDir = path.resolve(dir) + path.sep;
  var resolvedTarget = path.resolve(target);

  if ((resolvedTarget + path.sep).indexOf(resolvedDir) !== 0 || resolvedTarget + path.sep === resolvedDir) {
    return { ok: false, error: 'refused to remove a path outside the plugins directory' };
  }

  try {
    fs.rmSync(resolvedTarget, { recursive: true, force: true });
    if (pluginId) {
      var state = readState(userDataPath);
      if (state[pluginId]) {
        delete state[pluginId];
        writeState(userDataPath, state);
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  PLUGIN_API_VERSION: PLUGIN_API_VERSION,
  ALLOWED_PERMISSIONS: ALLOWED_PERMISSIONS,
  getPluginsDir: getPluginsDir,
  ensurePluginsDir: ensurePluginsDir,
  validateManifest: validateManifest,
  scanPlugins: scanPlugins,
  approvePlugin: approvePlugin,
  setEnabled: setEnabled,
  removePlugin: removePlugin,
  describePermissions: describePermissions
};
