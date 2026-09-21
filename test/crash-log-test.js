#!/usr/bin/env node
/* ============================================================
   Kanvaz — crash-log.js test
   Usage: node test/crash-log-test.js
   ============================================================ */

var path = require('path');
var fs = require('fs');
var os = require('os');
var assert = require('assert');
var cl = require(path.join(__dirname, '..', 'src', 'crash-log.js'));

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanvaz-crash-test-'));

function run() {
  var home = process.platform === 'win32' ? 'C:\\Users\\alice' : '/home/alice';
  assert.strictEqual(cl.appendCrash(TMP, { kind: 'uncaughtException', message: 'boom at ' + home + '\\x', stack: 'at f (' + home + '/proj/a.js:1)' }, { home: home, version: '9.9.9' }), true);
  var file = path.join(TMP, 'crash.log');
  var lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  var rec = JSON.parse(lines[0]);
  assert.strictEqual(rec.kind, 'uncaughtException');
  assert.strictEqual(rec.version, '9.9.9');
  assert.ok(rec.time && !isNaN(Date.parse(rec.time)));
  assert.ok(rec.message.indexOf('alice') === -1 && rec.stack.indexOf('alice') === -1, 'home directory (OS username) must be masked: ' + lines[0]);
  console.log('  ✓ writes one JSON line per event and masks the home directory');

  cl.appendCrash(TMP, { kind: 'x', message: new Array(50000).join('a') }, { home: home });
  var last = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop());
  assert.ok(last.message.length < 4100, 'oversized fields are clipped, got ' + last.message.length);
  console.log('  ✓ oversized fields are clipped');

  fs.writeFileSync(file, new Array(cl.MAX_BYTES + 10).join('x'), 'utf8');
  cl.appendCrash(TMP, { kind: 'rotate', message: 'm' }, { home: home });
  assert.ok(fs.existsSync(file + '.1'), 'the full log is rotated to crash.log.1');
  assert.ok(fs.statSync(file).size < 2000, 'the new log starts small');
  console.log('  ✓ rotates at 1 MB, keeping one previous generation');

  assert.strictEqual(cl.appendCrash(path.join(TMP, 'no', 'such', 'dir'), { kind: 'k', message: 'm' }), false, 'a failing logger returns false instead of throwing');
  assert.strictEqual(cl.appendCrash(TMP, null), true, 'a null entry is tolerated');
  console.log('  ✓ logger failures never throw');
}

try {
  run();
  console.log('\nALL CRASH LOG TESTS PASSED');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
} catch (e) {
  console.error('\nCRASH LOG TEST FAILED');
  console.error(e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
}
