#!/usr/bin/env node
/* ============================================================
   Kanvaz — save-guard.js test (shared-drive overwrite guard)
   Usage: node test/save-guard-test.js
   Uses real temp files and forged mtimes, not mocks.
   ============================================================ */

var path = require('path');
var fs = require('fs');
var os = require('os');
var assert = require('assert');
var sg = require(path.join(__dirname, '..', 'src', 'save-guard.js'));

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanvaz-save-guard-'));
function cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function setMtime(p, ms) { fs.utimesSync(p, ms / 1000, ms / 1000); }
function read(p) { return fs.readFileSync(p, 'utf8'); }

function run() {
  var T = sg.MTIME_TOLERANCE_MS;

  /* ── pure comparison ── */
  assert.strictEqual(sg.isConflict(null, 5000), false, 'no expectation is never a conflict');
  assert.strictEqual(sg.isConflict(undefined, 5000), false);
  assert.strictEqual(sg.isConflict(5000, null), false, 'missing disk file is never a conflict');
  assert.strictEqual(sg.isConflict(5000, 5000), false);
  assert.strictEqual(sg.isConflict(5000, 5000 + T), false, 'exactly at tolerance is not a conflict');
  assert.strictEqual(sg.isConflict(5000, 5000 + T + 1), true, 'just past tolerance is a conflict');
  assert.strictEqual(sg.isConflict(5000 + T + 1, 5000), true, 'an OLDER file on disk is also a difference');
  assert.strictEqual(sg.isConflict(NaN, 5000), false, 'garbage expectation is ignored, not trusted');
  assert.strictEqual(sg.isConflict('5000', 6000000), false, 'string expectation is ignored');
  console.log('  ✓ isConflict: tolerance edges, null/missing/garbage inputs');

  var target = path.join(dir, 'a.kanvaz');
  var p = Promise.resolve();

  /* ── first save: no expectation, file does not exist ── */
  p = p.then(function() {
    return sg.guardedWrite(target, Buffer.from('v1'), {});
  }).then(function(r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(typeof r.mtimeMs, 'number');
    assert.strictEqual(read(target), 'v1');
    assert.strictEqual(fs.existsSync(target + '.tmp'), false, 'no .tmp left behind');
    console.log('  ✓ first save writes the file and returns its mtime');
  });

  /* ── our own follow-up save with the mtime we were given: no conflict ── */
  p = p.then(function() {
    var m = fs.statSync(target).mtimeMs;
    return sg.guardedWrite(target, Buffer.from('v2'), { expectedMtimeMs: m });
  }).then(function(r) {
    assert.strictEqual(r.ok, true, 'saving over our own last write must not conflict');
    assert.strictEqual(read(target), 'v2');
    console.log('  ✓ saving over our own last write is not a conflict');
  });

  /* ── someone else saved in between (mtime moved) ── */
  p = p.then(function() {
    var mine = fs.statSync(target).mtimeMs;
    fs.writeFileSync(target, 'THEIRS');
    setMtime(target, mine + 60000); /* a minute later, from "another machine" */
    return sg.guardedWrite(target, Buffer.from('v3-mine'), { expectedMtimeMs: mine }).then(function(r) {
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.conflict, true, 'must report a conflict');
      assert.strictEqual(typeof r.diskMtimeMs, 'number');
      assert.strictEqual(read(target), 'THEIRS', 'the other person\'s file must be untouched');
      assert.strictEqual(fs.existsSync(target + '.tmp'), false, '.tmp must be cleaned up on conflict');
      console.log('  ✓ a foreign save is detected, nothing is overwritten, .tmp removed');
      return mine;
    });
  });

  /* ── user chose Overwrite ── */
  p = p.then(function(mine) {
    return sg.guardedWrite(target, Buffer.from('v3-forced'), { expectedMtimeMs: mine, force: true });
  }).then(function(r) {
    assert.strictEqual(r.ok, true, 'force bypasses the check');
    assert.strictEqual(read(target), 'v3-forced');
    console.log('  ✓ force (user chose Overwrite) writes through');
  });

  /* ── file deleted since we opened it: recreate, no conflict ── */
  p = p.then(function() {
    var m = fs.statSync(target).mtimeMs;
    fs.unlinkSync(target);
    return sg.guardedWrite(target, Buffer.from('v4'), { expectedMtimeMs: m });
  }).then(function(r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(read(target), 'v4');
    console.log('  ✓ a deleted target is recreated without a false conflict');
  });

  /* ── 2s-rounding filesystem: disk mtime within tolerance of ours ── */
  p = p.then(function() {
    var m = fs.statSync(target).mtimeMs;
    setMtime(target, m + 1500);
    return sg.guardedWrite(target, Buffer.from('v5'), { expectedMtimeMs: m });
  }).then(function(r) {
    assert.strictEqual(r.ok, true, 'sub-tolerance drift must not read as a foreign save');
    console.log('  ✓ 2 s mtime rounding does not cause a false conflict');
  });

  /* ── real failure still surfaces and cleans up ── */
  p = p.then(function() {
    var bad = path.join(dir, 'no-such-dir', 'x.kanvaz');
    return sg.guardedWrite(bad, Buffer.from('x'), {});
  }).then(function(r) {
    assert.strictEqual(r.ok, false);
    assert.ok(r.error, 'an fs failure carries an error message');
    assert.ok(!r.conflict);
    console.log('  ✓ real write failures return {ok:false, error} (not a conflict)');
  });

  return p;
}

run().then(function() {
  cleanup();
  console.log('\n  ALL SAVE GUARD TESTS PASSED');
}).catch(function(e) {
  cleanup();
  console.error('\n  FAIL:', e && e.stack || e);
  process.exit(1);
});
