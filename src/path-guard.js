/* path-guard.js — trust checks for filesystem paths that cross the IPC
   boundary from the renderer into main.js.

   Why this exists (2026-09-20 audit): a .kanvaz board is just JSON, and it
   can be shared by someone untrusted. Every card "path" in it, and every
   argument a compromised renderer or plugin sends, reaches main-process
   fs/shell calls. Three separate weaknesses lived here:
     1. file-read / file-write accepted ANY path, so a hostile renderer could
        overwrite or read arbitrary files. Now a board path must (a) end in
        .kanvaz and (b) have been GRANTED by main itself (native dialog, OS
        file association / argv, or the recent list main wrote).
     2. shell-open-path used a 22-entry extension blocklist that missed .hta,
        .chm, .msc, .cpl, .py, macro-enabled Office files, and more.
        Media formats are open-ended for a professional reference tool, so an
        allowlist would break legitimate references; the blocklist is
        widened instead and paired with the rules below.
     3. A card path like \\attacker\share\x.png made Windows open an SMB
        connection just by rendering the card, leaking the user's NTLM hash.
        Remote/UNC/device paths are now refused everywhere a path is used.

   Node-only, no electron require, so test/path-guard-test.js can run it.
   ES5/var-only like the rest of src/. */

var path = require('path');

/* Extensions whose default handler EXECUTES the file or a script inside it
   (or, for .url/.library-ms/.searchConnector-ms/.theme etc., can reach out
   to a remote host). Lower-case, no dot. */
var UNSAFE_OPEN_EXTENSIONS = [
  /* native executables / installers */
  'exe', 'com', 'scr', 'pif', 'msi', 'msp', 'mst', 'msix', 'msixbundle', 'appx', 'appxbundle',
  'dll', 'sys', 'ocx', 'drv', 'cpl', 'msc', 'application', 'appref-ms', 'gadget', 'apk', 'app',
  /* scripts */
  'bat', 'cmd', 'ps1', 'ps1xml', 'ps2', 'ps2xml', 'psc1', 'psc2', 'psm1', 'psd1',
  'vbs', 'vbe', 'vb', 'bas', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'hta',
  'sh', 'bash', 'zsh', 'command', 'py', 'pyw', 'pyc', 'pl', 'rb', 'jar', 'jnlp',
  /* shortcuts, registry, remote-reaching handlers */
  'lnk', 'url', 'reg', 'inf', 'scf', 'chm', 'library-ms', 'searchconnector-ms',
  'settingcontent-ms', 'theme', 'themepack', 'diagcab', 'xll',
  /* macro-enabled Office documents */
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm',
  /* macOS / Linux launchers, disk images, remote-desktop and config profiles */
  'desktop', 'scpt', 'scptd', 'workflow', 'action', 'terminal', 'mobileconfig', 'pkg', 'mpkg',
  'dmg', 'iso', 'img', 'vhd', 'vhdx', 'rdp', 'ws', 'csh', 'ksh', 'fish', 'run', 'bin'
];

function isString(p) { return typeof p === 'string' && p.length > 0 && p.indexOf('\0') === -1; }

/* Refuses UNC (\\host\share), device (\\.\ and \\?\) and any other path
   starting with two separators, plus relative paths. A mapped network drive
   letter (Z:\) can't be told apart from a local one here; that residual case
   is accepted. */
function isLocalAbsolutePath(p) {
  if (!isString(p)) return false;
  if (/^[\\/]{2}/.test(p)) return false;
  return path.isAbsolute(p);
}

/* Windows silently drops trailing dots and spaces from a file name, so
   "x.hta." and "x.hta " open as x.hta. Strip them before reading the
   extension, or they would slip past the blocklist. */
function extOf(p) {
  var base = path.basename(String(p)).replace(/[. ]+$/, '');
  var e = path.extname(base).toLowerCase();
  return e ? e.slice(1) : '';
}

/* {ok:true} or {ok:false, reason} — for shell.openPath. */
function checkOpenable(p, platform) {
  platform = platform || process.platform;
  if (!isString(p)) return { ok: false, reason: 'Invalid path' };
  if (!isLocalAbsolutePath(p)) return { ok: false, reason: 'Only local files can be opened from Kanvaz.' };
  /* NTFS alternate data streams (file.png:evil.exe, file.hta::$DATA) name a
     different payload than the visible extension; a colon anywhere past the
     drive letter is never a legitimate reference. */
  if (platform === 'win32' && p.indexOf(':', 2) !== -1) {
    return { ok: false, reason: 'Kanvaz won\'t open paths containing alternate data streams.' };
  }
  var ext = extOf(p);
  if (ext && UNSAFE_OPEN_EXTENSIONS.indexOf(ext) !== -1) {
    return { ok: false, reason: 'Kanvaz won\'t open ' + ext.toUpperCase() + ' files directly for safety — open it from your file manager if you trust the source.' };
  }
  /* macOS `open` runs an extensionless Unix executable in Terminal, and
     Linux desktops can run one too; on Windows an extensionless file is
     not executable, so it stays allowed there. */
  if (!ext && platform !== 'win32') {
    return { ok: false, reason: 'Kanvaz won\'t open files with no extension directly for safety.' };
  }
  return { ok: true };
}

function grantKey(p, platform) {
  var k = path.resolve(p);
  return (platform || process.platform) === 'win32' ? k.toLowerCase() : k;
}

/* A set of paths main.js itself has handed out or received from a native
   dialog / the OS. Only a granted, .kanvaz path may be read or written. */
function createGrants(platform) {
  var set = Object.create(null);
  return {
    grant: function(p) {
      if (!isLocalAbsolutePath(p)) return false;
      set[grantKey(p, platform)] = true;
      return true;
    },
    has: function(p) {
      if (!isLocalAbsolutePath(p)) return false;
      return set[grantKey(p, platform)] === true;
    }
  };
}

function isBoardPath(p) {
  return isLocalAbsolutePath(p) && extOf(p) === 'kanvaz';
}

module.exports = {
  UNSAFE_OPEN_EXTENSIONS: UNSAFE_OPEN_EXTENSIONS,
  isLocalAbsolutePath: isLocalAbsolutePath,
  checkOpenable: checkOpenable,
  isBoardPath: isBoardPath,
  createGrants: createGrants
};
