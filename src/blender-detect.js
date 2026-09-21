/* blender-detect.js — locates a local Blender install (optional external
   tool used to convert .blend -> .glb; see main.js's model-convert-external).

   Found live 2026-09-20: a user with Blender 5.2.1 installed at F:\Blender
   got the "install Blender" fallback, because the old detection checked
   only C:\Program Files\Blender Foundation\Blender {3.0..5.0}. A drive-F
   install, a folder without the "Blender Foundation" parent, and any
   version above the hardcoded list were all invisible.

   Order is deliberately cheap-first: the main process is single-threaded
   and this runs on a file drop, so nothing here may block for long.
   (No blind drive-letter scan — a disconnected mapped network drive can
   make a bare statSync hang for many seconds and freeze the whole app; the
   registry lookup finds custom install drives without one.)
     1. explicit user override (settings.json "blenderPath" / BLENDER_PATH)
     2. PATH (also catches the Microsoft Store alias)
     3. standard install roots, versioned folders sorted NEWEST FIRST
        (no hardcoded version list to go stale)
     4. Windows Uninstall registry -> InstallLocation (any drive; verified
        against a real MSI install), last because it spawns `reg`
     5. package-manager / Steam locations
   Every candidate must be an existing FILE. Returns null when nothing is
   found (the caller reports EXTERNAL_TOOL_NOT_FOUND directly) instead of
   the old bare-"blender" fallback that only failed later with a
   misleading ENOENT. blender.exe is preferred over blender-launcher.exe:
   the launcher detaches and breaks stdio and exit codes.

   Node-only (no electron require) so test/blender-detect-test.js can run
   it directly. ES5/var-only like the rest of src/. */

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

/* "Blender 4.2", "Blender 5.2.1", "blender-4.2.3-windows-x64" -> [4,2,3] */
function versionKey(name) {
  var m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(name);
  return m ? [parseInt(m[1], 10), parseInt(m[2] || '0', 10), parseInt(m[3] || '0', 10)] : [0, 0, 0];
}

function cmpVersionDesc(a, b) {
  var ka = versionKey(a), kb = versionKey(b);
  for (var i = 0; i < 3; i++) {
    if (ka[i] !== kb[i]) return kb[i] - ka[i];
  }
  return 0;
}

/* Every immediate sub-folder of `root` whose name matches `re`, newest
   version first, with `exeRel` appended. Pushes onto `out`. */
function scanVersioned(root, re, exeRel, out) {
  var names;
  try { names = fs.readdirSync(root); } catch (e) { return; }
  names = names.filter(function(n) { return re.test(n); }).sort(cmpVersionDesc);
  for (var i = 0; i < names.length; i++) out.push(path.join(root, names[i], exeRel));
}

function pathScan(exeNames, env, out) {
  var dirs = (env.PATH || env.Path || '').split(path.delimiter);
  for (var i = 0; i < dirs.length; i++) {
    if (!dirs[i]) continue;
    for (var j = 0; j < exeNames.length; j++) out.push(path.join(dirs[i], exeNames[j]));
  }
}

/* Pure parser (exported for the test): pulls InstallLocation values out of
   `reg query ... /s /f Blender /d` output. The MSI writes
   Uninstall\{GUID}\InstallLocation; the old HKLM\SOFTWARE\BlenderFoundation
   key is NOT written by current installers. */
function parseRegInstallLocations(text) {
  var out = [];
  var lines = String(text || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = /^\s+InstallLocation\s+REG_SZ\s+(.+?)\s*$/.exec(lines[i]);
    if (m) out.push(path.join(m[1], 'blender.exe'));
  }
  return out;
}

/* Pure parsers (exported for the test) for Windows' own record of which program
   opens .blend files. Wherever Blender really is, however it was installed
   (portable copy, another drive, Steam, a custom folder), this points at it.
   `reg query HKCR\.blend /ve` prints the ProgID; `reg query
   HKCR\<ProgID>\shell\open\command /ve` prints e.g.
   "F:\Blender\blender-launcher.exe" "%1". */
function parseAssocProgId(text) {
  var m = /^\s+\(Default\)\s+REG_SZ\s+(\S.*?)\s*$/m.exec(String(text || ''));
  return m ? m[1] : null;
}

function parseOpenCommand(text) {
  var m = /^\s+\(Default\)\s+REG_SZ\s+(.+?)\s*$/m.exec(String(text || ''));
  if (!m) return null;
  var cmd = m[1];
  var q = /^"([^"]+)"/.exec(cmd);
  var exe = q ? q[1] : (/^(\S+\.exe)/i.exec(cmd) || [null, null])[1];
  return exe || null;
}

/* Candidates from the .blend association: the launcher's own folder, preferring
   blender.exe next to it (the launcher detaches and breaks stdio). */
function windowsAssociation(out) {
  var roots = ['HKCU\\SOFTWARE\\Classes', 'HKCR'];
  for (var i = 0; i < roots.length; i++) {
    try {
      var t1 = execFileSync('reg', ['query', roots[i] + '\\.blend', '/ve'], { encoding: 'utf8', windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      var prog = parseAssocProgId(t1);
      if (!prog || /[\\\/"]/.test(prog)) continue;
      var t2 = execFileSync('reg', ['query', roots[i] + '\\' + prog + '\\shell\\open\\command', '/ve'], { encoding: 'utf8', windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      var exe = parseOpenCommand(t2);
      if (!exe) continue;
      var dir = path.dirname(exe);
      out.push(path.join(dir, 'blender.exe'));
      out.push(exe);
    } catch (e) { /* not registered under this root */ }
  }
}

/* macOS: Spotlight knows where every .app is, wherever the user put it. */
function macSpotlight(out) {
  try {
    var txt = execFileSync('mdfind', ['kMDItemCFBundleIdentifier == "org.blenderfoundation.blender"'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    var lines = txt.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      if (/\.app$/i.test(lines[i])) out.push(path.join(lines[i], 'Contents', 'MacOS', 'Blender'));
    }
  } catch (e) { /* no Spotlight index */ }
}

/* Asks the executable itself: runs `blender --version` (array args, short
   timeout) and returns "5.2.1" or null. This is how a user-chosen file is
   proven to be Blender before it is remembered, and what the Settings status
   shows. */
function blenderVersion(exe) {
  if (!exe || !isFile(exe)) return null;
  try {
    var txt = execFileSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    var m = /Blender\s+(\d+(?:\.\d+){1,2})/i.exec(txt);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

function windowsRegistryInstalls(out) {
  var hives = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ];
  for (var i = 0; i < hives.length; i++) {
    var txt = '';
    try {
      /* Array args, never a shell string; short timeout so a wedged `reg`
         can't stall the app. */
      txt = execFileSync('reg', ['query', hives[i], '/s', '/f', 'Blender', '/d'],
        { encoding: 'utf8', windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { continue; }
    var found = parseRegInstallLocations(txt);
    for (var j = 0; j < found.length; j++) out.push(found[j]);
  }
}

function firstExisting(list) {
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var k = list[i].toLowerCase();
    if (seen[k]) continue;
    seen[k] = 1;
    if (isFile(list[i])) return list[i];
  }
  return null;
}

/* opts (all optional, for tests): { platform, env } */
function findBlenderExecutable(userOverride, opts) {
  opts = opts || {};
  var platform = opts.platform || process.platform;
  var env = opts.env || process.env;
  var c;
  var hit;

  c = [];
  if (userOverride) c.push(userOverride);
  if (env.BLENDER_PATH) c.push(env.BLENDER_PATH);
  hit = firstExisting(c);
  if (hit) return hit;

  if (platform === 'win32') {
    c = [];
    pathScan(['blender.exe'], env, c);
    var roots = [];
    var pf = env.ProgramFiles, pf86 = env['ProgramFiles(x86)'], la = env.LOCALAPPDATA;
    if (pf) roots.push(pf);
    if (pf86) roots.push(pf86);
    if (la) roots.push(path.join(la, 'Programs'));
    roots.push('C:\\Program Files');
    var seenRoot = {};
    for (var r = 0; r < roots.length; r++) {
      var rk = roots[r].toLowerCase();
      if (seenRoot[rk]) continue;
      seenRoot[rk] = 1;
      scanVersioned(path.join(roots[r], 'Blender Foundation'), /^Blender/i, 'blender.exe', c); /* default installer */
      scanVersioned(roots[r], /^Blender[ -]?\d/i, 'blender.exe', c);                            /* "Blender 4.2" */
      c.push(path.join(roots[r], 'Blender', 'blender.exe'));
    }
    hit = firstExisting(c);
    if (hit) return hit;

    c = [];
    /* The .blend association first (it names the Blender that actually opens
       .blend files, wherever it lives), then the uninstall keys. */
    if (opts.noRegistry !== true) windowsAssociation(c);
    windowsRegistryInstalls(c);                                                                 /* any drive, custom dir */
    hit = firstExisting(c);
    if (hit) return hit;

    c = [];
    if (la) c.push(path.join(la, 'Microsoft', 'WindowsApps', 'blender.exe'));                   /* Store alias */
    c.push(path.join(env.ChocolateyInstall || path.join(env.ProgramData || 'C:\\ProgramData', 'chocolatey'), 'bin', 'blender.exe'));
    if (env.USERPROFILE) {
      c.push(path.join(env.USERPROFILE, 'scoop', 'apps', 'blender', 'current', 'blender.exe'));
    }
    /* Default Steam library only — a Steam library on another drive is the
       user-override case, not worth a drive-letter probe (see header). */
    c.push('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe');
    return firstExisting(c);
  }

  c = [];
  if (platform === 'darwin') {
    c.push('/Applications/Blender.app/Contents/MacOS/Blender');
    if (opts.noRegistry !== true) macSpotlight(c);
    if (env.HOME) c.push(path.join(env.HOME, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender'));
    c.push('/opt/homebrew/bin/blender', '/usr/local/bin/blender');
  } else {
    pathScan(['blender'], env, c);
    c.push('/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender',
           '/var/lib/flatpak/exports/bin/org.blender.Blender');
    if (env.HOME) c.push(path.join(env.HOME, '.local', 'share', 'flatpak', 'exports', 'bin', 'org.blender.Blender'));
  }
  return firstExisting(c);
}

module.exports = {
  findBlenderExecutable: findBlenderExecutable,
  versionKey: versionKey,
  cmpVersionDesc: cmpVersionDesc,
  scanVersioned: scanVersioned,
  parseRegInstallLocations: parseRegInstallLocations,
  parseAssocProgId: parseAssocProgId,
  parseOpenCommand: parseOpenCommand,
  blenderVersion: blenderVersion
};
