#!/usr/bin/env node
/* ============================================================
   Kanvaz — blender-detect.js test
   Usage: node test/blender-detect-test.js
   Real filesystem layouts in a temp dir (no Blender needed).
   ============================================================ */

var path = require('path');
var fs = require('fs');
var os = require('os');
var assert = require('assert');
var det = require(path.join(__dirname, '..', 'src', 'blender-detect.js'));

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanvaz-blender-test-'));

function touch(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; }

function run() {
  /* version ordering — the old hardcoded list stopped at 5.0 */
  var names = ['Blender 3.6', 'Blender 5.2', 'Blender 4.5', 'Blender 5.10', 'Blender 5.9', 'Blender 5.2.1'];
  names.sort(det.cmpVersionDesc);
  assert.deepStrictEqual(names, ['Blender 5.10', 'Blender 5.9', 'Blender 5.2.1', 'Blender 5.2', 'Blender 4.5', 'Blender 3.6'],
    'versions must sort numerically newest-first (5.10 > 5.9), got ' + JSON.stringify(names));
  console.log('  ✓ versions sort numerically newest-first, with no upper bound');

  /* versioned scan finds a version far above the old 5.0 ceiling */
  var pf = path.join(TMP, 'Program Files');
  touch(path.join(pf, 'Blender Foundation', 'Blender 3.6', 'blender.exe'));
  touch(path.join(pf, 'Blender Foundation', 'Blender 5.2', 'blender.exe'));
  touch(path.join(pf, 'Blender Foundation', 'Blender 4.5', 'blender.exe'));
  var found = det.findBlenderExecutable(null, { platform: 'win32', env: { ProgramFiles: pf, PATH: '' } });
  assert.strictEqual(found, path.join(pf, 'Blender Foundation', 'Blender 5.2', 'blender.exe'), 'must pick the NEWEST installed version, got ' + found);
  console.log('  ✓ picks the newest installed version (5.2 — beyond the old hardcoded 5.0 cap)');

  /* the real-world miss: a plain "Blender" folder, no "Blender Foundation" parent */
  var pf2 = path.join(TMP, 'other-root');
  touch(path.join(pf2, 'Blender', 'blender.exe'));
  var found2 = det.findBlenderExecutable(null, { platform: 'win32', env: { ProgramFiles: pf2, PATH: '' } });
  assert.strictEqual(found2, path.join(pf2, 'Blender', 'blender.exe'), 'plain <root>\\Blender\\blender.exe must be found, got ' + found2);
  console.log('  ✓ finds a plain "Blender" folder with no "Blender Foundation" parent');

  /* blender-launcher.exe alone must not be returned as blender.exe */
  var pf3 = path.join(TMP, 'launcher-only');
  touch(path.join(pf3, 'Blender Foundation', 'Blender 4.2', 'blender-launcher.exe'));
  var found3 = det.findBlenderExecutable(null, { platform: 'win32', env: { ProgramFiles: pf3, PATH: '' } });
  assert.notStrictEqual(found3, path.join(pf3, 'Blender Foundation', 'Blender 4.2', 'blender-launcher.exe'), 'never resolve to blender-launcher.exe');
  console.log('  ✓ never resolves to blender-launcher.exe (it detaches and breaks stdio/exit codes)');

  /* PATH lookup */
  var pathDir = path.join(TMP, 'on-path');
  touch(path.join(pathDir, 'blender.exe'));
  var found4 = det.findBlenderExecutable(null, { platform: 'win32', env: { PATH: pathDir, ProgramFiles: path.join(TMP, 'empty') } });
  assert.strictEqual(found4, path.join(pathDir, 'blender.exe'), 'PATH entry must be found, got ' + found4);
  console.log('  ✓ finds Blender on PATH');

  /* user override wins over everything, and a bogus override falls through */
  var custom = touch(path.join(TMP, 'custom', 'my-blender.exe'));
  assert.strictEqual(det.findBlenderExecutable(custom, { platform: 'win32', env: { ProgramFiles: pf, PATH: '' } }), custom, 'explicit override must win');
  assert.strictEqual(det.findBlenderExecutable(path.join(TMP, 'nope.exe'), { platform: 'win32', env: { ProgramFiles: pf, PATH: '' } }),
    path.join(pf, 'Blender Foundation', 'Blender 5.2', 'blender.exe'), 'a bogus override must fall through to auto-detection');
  assert.strictEqual(det.findBlenderExecutable(null, { platform: 'win32', env: { BLENDER_PATH: custom, PATH: '', ProgramFiles: pf } }), custom, 'BLENDER_PATH env must be honored');
  console.log('  ✓ user override and BLENDER_PATH win; a bogus override falls through');

  /* nothing installed -> null, NOT a bare "blender" string */
  var none = det.findBlenderExecutable(null, { platform: 'linux', env: { PATH: path.join(TMP, 'nothing-here') } });
  assert.strictEqual(none === null || fs.existsSync(none), true, 'must return null (or a real file) when nothing is installed, got ' + none);
  console.log('  ✓ returns null when nothing is found (no misleading bare "blender" fallback)');

  /* registry parser against real `reg query` output shape (verified on a real MSI install) */
  var sample = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{89F38CAB-1111-2222-3333-444455556666}',
    '    DisplayName    REG_SZ    Blender',
    '    InstallLocation    REG_SZ    F:\\Blender\\',
    '    Publisher    REG_SZ    Blender Foundation',
    ''
  ].join('\r\n');
  var parsed = det.parseRegInstallLocations(sample);
  assert.strictEqual(parsed.length, 1, 'one InstallLocation expected, got ' + parsed.length);
  assert.strictEqual(parsed[0], path.join('F:\\Blender\\', 'blender.exe'));
  assert.deepStrictEqual(det.parseRegInstallLocations('no match here'), []);
  console.log('  ✓ registry InstallLocation parser handles real reg-query output (F:\\Blender case)');
}

try {
  run();
  console.log('\nALL BLENDER DETECT TESTS PASSED');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
} catch (e) {
  console.error('\nBLENDER DETECT TEST FAILED');
  console.error(e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
}
