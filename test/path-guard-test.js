#!/usr/bin/env node
/* ============================================================
   Kanvaz — path-guard.js test
   Usage: node test/path-guard-test.js
   ============================================================ */

var path = require('path');
var assert = require('assert');
var pg = require(path.join(__dirname, '..', 'src', 'path-guard.js'));

var W = process.platform === 'win32';
var ABS = W ? 'C:\\Users\\a\\refs\\' : '/home/a/refs/';

function run() {
  /* remote / device / relative paths are never local-absolute */
  ['\\\\evil\\share\\x.png', '//evil/share/x.png', '\\\\?\\UNC\\evil\\share\\x.png', '\\\\.\\pipe\\x', 'refs\\x.png', './x.png', '', null, undefined, 42, 'a\0b.png']
    .forEach(function(p) { assert.strictEqual(pg.isLocalAbsolutePath(p), false, 'must refuse ' + JSON.stringify(p)); });
  assert.strictEqual(pg.isLocalAbsolutePath(ABS + 'x.png'), true);
  console.log('  ✓ UNC, device, relative, non-string and NUL paths are refused (NTLM-leak class)');

  /* the extensions the OLD 22-entry list missed */
  ['hta', 'chm', 'msc', 'cpl', 'py', 'pyw', 'url', 'pif', 'docm', 'xlsm', 'jnlp', 'library-ms', 'searchconnector-ms', 'diagcab', 'msix', 'wsc', 'xll', 'theme', 'settingcontent-ms']
    .forEach(function(e) {
      assert.strictEqual(pg.checkOpenable(ABS + 'file.' + e).ok, false, e + ' must be blocked');
      assert.strictEqual(pg.checkOpenable(ABS + 'FILE.' + e.toUpperCase()).ok, false, e + ' must be blocked case-insensitively');
    });
  /* and the originals still are */
  ['exe', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'msi', 'jar', 'sh', 'app', 'lnk', 'reg']
    .forEach(function(e) { assert.strictEqual(pg.checkOpenable(ABS + 'f.' + e).ok, false, e + ' must stay blocked'); });
  console.log('  ✓ blocklist covers the previously missed launchers and keeps the original ones');

  /* what a reference tool legitimately opens must still work */
  ['pdf', 'png', 'jpg', 'psd', 'blend', 'fbx', 'glb', 'obj', 'mp4', 'mov', 'wav', 'txt', 'md', 'docx', 'xlsx', 'kra', 'clip', 'zpr', 'spp', 'ai', 'svg', 'usd', 'json', 'csv']
    .forEach(function(e) { assert.strictEqual(pg.checkOpenable(ABS + 'ref.' + e).ok, true, e + ' must stay openable'); });
  console.log('  ✓ real professional reference formats stay openable');

  /* double extension: the LAST one decides, and it is still blocked */
  assert.strictEqual(pg.checkOpenable(ABS + 'photo.png.exe').ok, false);
  assert.strictEqual(pg.checkOpenable(ABS + 'setup.exe.png').ok, true);
  assert.strictEqual(pg.checkOpenable('\\\\evil\\share\\ok.pdf').ok, false);
  assert.strictEqual(pg.checkOpenable('').ok, false);
  assert.strictEqual(pg.checkOpenable(ABS + 'Makefile', 'darwin').ok, false, 'extensionless is refused off Windows');
  assert.strictEqual(pg.checkOpenable(ABS + 'LICENSE', 'win32').ok, true, 'extensionless is fine on Windows');
  console.log('  ✓ double extensions, UNC and extensionless-executable cases behave');

  /* Windows trailing dot/space and alternate data streams (found by the security sweep) */
  assert.strictEqual(pg.checkOpenable('C:\\r\\x.hta.', 'win32').ok, false, 'trailing dot must not hide the extension');
  assert.strictEqual(pg.checkOpenable('C:\\r\\x.hta ', 'win32').ok, false, 'trailing space must not hide the extension');
  assert.strictEqual(pg.checkOpenable('C:\\r\\x.hta. . ', 'win32').ok, false, 'mixed trailing dots/spaces');
  assert.strictEqual(pg.checkOpenable('C:\\r\\x.png:evil.exe', 'win32').ok, false, 'alternate data stream refused');
  assert.strictEqual(pg.checkOpenable('C:\\r\\x.hta::$DATA', 'win32').ok, false, '::$DATA stream refused');
  assert.strictEqual(pg.checkOpenable('C:\\r\\ok.png', 'win32').ok, true, 'a normal drive path still opens');
  ['desktop', 'scpt', 'workflow', 'pkg', 'dmg', 'iso', 'rdp', 'ws', 'terminal', 'mobileconfig']
    .forEach(function(e) { assert.strictEqual(pg.checkOpenable(ABS + 'f.' + e).ok, false, e + ' must be blocked'); });
  console.log('  ✓ trailing dot/space, alternate data streams and macOS/Linux launchers are blocked');

  /* board path + grants */
  assert.strictEqual(pg.isBoardPath(ABS + 'b.kanvaz'), true);
  assert.strictEqual(pg.isBoardPath(ABS + 'b.KANVAZ'), true);
  assert.strictEqual(pg.isBoardPath(ABS + 'b.kanvaz.exe'), false);
  assert.strictEqual(pg.isBoardPath(ABS + '.bashrc'), false);
  assert.strictEqual(pg.isBoardPath('\\\\evil\\s\\b.kanvaz'), false);
  var g = pg.createGrants();
  assert.strictEqual(g.has(ABS + 'b.kanvaz'), false, 'nothing is granted by default');
  assert.strictEqual(g.grant(ABS + 'b.kanvaz'), true);
  assert.strictEqual(g.has(ABS + 'b.kanvaz'), true);
  assert.strictEqual(g.has(ABS + 'other.kanvaz'), false, 'a grant covers one path only');
  assert.strictEqual(g.has(ABS + 'sub' + path.sep + '..' + path.sep + 'b.kanvaz'), true, 'normalised before comparing');
  assert.strictEqual(g.grant('\\\\evil\\s\\b.kanvaz'), false, 'remote paths can never be granted');
  assert.strictEqual(g.has('__proto__'), false);
  assert.strictEqual(g.has('constructor'), false);
  if (W) assert.strictEqual(g.has(ABS.toUpperCase() + 'B.KANVAZ'), true, 'Windows paths are case-insensitive');
  console.log('  ✓ board paths need .kanvaz + an explicit grant; grants are per-path, normalised, never remote');
}

try {
  run();
  console.log('\nALL PATH GUARD TESTS PASSED');
  process.exit(0);
} catch (e) {
  console.error('\nPATH GUARD TEST FAILED');
  console.error(e);
  process.exit(1);
}
