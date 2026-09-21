#!/usr/bin/env node
/* ============================================================
   Kanvaz — mcp-auth.js test
   Usage: node test/mcp-auth-test.js
   ============================================================ */

var path = require('path');
var fs = require('fs');
var os = require('os');
var assert = require('assert');
var auth = require(path.join(__dirname, '..', 'src', 'mcp-auth.js'));

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanvaz-mcp-auth-'));

function run() {
  var t1 = auth.generateToken();
  var t2 = auth.generateToken();
  assert.ok(/^[0-9a-f]{64}$/.test(t1), 'token is 256 bits of hex, got ' + t1);
  assert.notStrictEqual(t1, t2, 'every token is fresh');
  console.log('  ✓ tokens are 256-bit random and never repeat');

  assert.strictEqual(auth.verifyToken(t1, t1), true);
  assert.strictEqual(auth.verifyToken(t2, t1), false);
  assert.strictEqual(auth.verifyToken(t1.slice(0, 63), t1), false, 'a prefix must not pass');
  assert.strictEqual(auth.verifyToken(t1 + 'x', t1), false, 'an extension must not pass');
  [undefined, null, '', 0, 123, {}, [], true].forEach(function(bad) {
    assert.strictEqual(auth.verifyToken(bad, t1), false, 'non-string / empty candidate refused: ' + JSON.stringify(bad));
  });
  assert.strictEqual(auth.verifyToken(t1, ''), false, 'an empty expected token (bridge not started) never authorizes');
  assert.strictEqual(auth.verifyToken(t1, null), false);
  assert.strictEqual(auth.verifyToken('', ''), false, 'empty === empty must not authorize');
  console.log('  ✓ only the exact token passes; missing/short/long/non-string/empty all fail');

  var file = auth.writeTokenFile(TMP, t1);
  assert.strictEqual(file, path.join(TMP, 'mcp-bridge.token'));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), t1);
  assert.ok(!fs.existsSync(file + '.tmp'), 'no leftover tmp file');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'token file must be owner-only on POSIX');
    console.log('  ✓ token file is written atomically with mode 0600');
  } else {
    console.log('  ✓ token file is written atomically (0600 mode not applicable on Windows; folder ACL applies)');
  }
  auth.writeTokenFile(TMP, t2);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), t2, 'a new bridge start replaces the token');
  auth.removeTokenFile(TMP);
  assert.ok(!fs.existsSync(file), 'stopping the bridge deletes the token file');
  auth.removeTokenFile(TMP); /* idempotent, must not throw */
  console.log('  ✓ token file rotates on restart and is removed on stop');
}

try {
  run();
  console.log('\nALL MCP AUTH TESTS PASSED');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
} catch (e) {
  console.error('\nMCP AUTH TEST FAILED');
  console.error(e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
}
