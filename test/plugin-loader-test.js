#!/usr/bin/env node
/* ============================================================
   Kanvaz — plugin-loader.js test
   Verifies manifest validation degrades gracefully instead of
   crashing, permission escalation on a plugin update re-triggers
   consent instead of inheriting the old approval, and removePlugin()
   refuses to touch anything outside the plugins directory.
   Usage: node test/plugin-loader-test.js
   ============================================================ */

var path = require('path');
var fs = require('fs');
var os = require('os');
var assert = require('assert');
var pluginLoader = require(path.join(__dirname, '..', 'src', 'plugin-loader.js'));

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanvaz-plugin-test-'));

function writePlugin(id, folder, manifestOverrides, entryContent) {
  var dir = path.join(TMP, 'plugins', folder);
  fs.mkdirSync(dir, { recursive: true });
  var manifest = Object.assign({
    id: id,
    name: 'Test Plugin ' + id,
    version: '1.0.0',
    kanvazApiVersion: pluginLoader.PLUGIN_API_VERSION,
    entry: 'main.js',
    permissions: ['cardTypes']
  }, manifestOverrides || {});
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf8');
  fs.writeFileSync(path.join(dir, 'main.js'), entryContent || '/* test plugin */', 'utf8');
  return dir;
}

function run() {
  /* 1. A valid, never-approved plugin loads and correctly needs consent */
  writePlugin('com.test.valid', 'valid-plugin');
  var results = pluginLoader.scanPlugins(TMP);
  var valid = results.filter(function(p) { return p.folder === 'valid-plugin'; })[0];
  assert.ok(valid, 'valid plugin must appear in scan results');
  assert.strictEqual(valid.valid, true, 'well-formed manifest must be accepted');
  assert.strictEqual(valid.needsConsent, true, 'a never-approved plugin must need consent');
  assert.strictEqual(valid.enabled, false, 'a never-approved plugin must not be enabled');
  console.log('  ✓ valid plugin scanned correctly, needs consent before first enable');

  /* 2. Missing required field degrades gracefully, never throws */
  writePlugin('com.test.missing', 'missing-field-plugin', { version: undefined });
  /* Object.assign with an undefined value still sets the key to
     undefined, which JSON.stringify drops entirely — exactly simulates
     a manifest.json that never had "version" in the first place. */
  var afterMissing = pluginLoader.scanPlugins(TMP);
  var missing = afterMissing.filter(function(p) { return p.folder === 'missing-field-plugin'; })[0];
  assert.ok(missing, 'malformed plugin must still appear (as invalid), not disappear silently');
  assert.strictEqual(missing.valid, false, 'a manifest missing a required field must be rejected');
  assert.ok(/version/.test(missing.reason), 'reason should mention the missing field: ' + missing.reason);
  console.log('  ✓ missing required field rejected without crashing the scan');

  /* 3. kanvazApiVersion mismatch degrades gracefully */
  writePlugin('com.test.futureversion', 'future-version-plugin', { kanvazApiVersion: 999 });
  var afterFuture = pluginLoader.scanPlugins(TMP);
  var future = afterFuture.filter(function(p) { return p.folder === 'future-version-plugin'; })[0];
  assert.strictEqual(future.valid, false, 'an unsupported kanvazApiVersion must be rejected');
  assert.ok(/v999/.test(future.reason), 'reason should mention the requested version: ' + future.reason);
  console.log('  ✓ kanvazApiVersion mismatch rejected without crashing the scan');

  /* 4. Permission escalation on an update re-triggers consent */
  writePlugin('com.test.escalate', 'escalate-plugin', { permissions: ['cardTypes'] });
  pluginLoader.approvePlugin(TMP, 'com.test.escalate', '1.0.0', ['cardTypes']);
  var afterApprove = pluginLoader.scanPlugins(TMP);
  var approved = afterApprove.filter(function(p) { return p.folder === 'escalate-plugin'; })[0];
  assert.strictEqual(approved.needsConsent, false, 'an approved plugin with unchanged permissions must not need consent again');
  assert.strictEqual(approved.enabled, true, 'an approved plugin must be enabled');

  /* Simulate an update that adds a new permission */
  writePlugin('com.test.escalate', 'escalate-plugin', { version: '1.1.0', permissions: ['cardTypes', 'network'] });
  var afterEscalate = pluginLoader.scanPlugins(TMP);
  var escalated = afterEscalate.filter(function(p) { return p.folder === 'escalate-plugin'; })[0];
  assert.strictEqual(escalated.needsConsent, true, 'a permission-escalating update must re-require consent');
  assert.strictEqual(escalated.enabled, false, 'a plugin needing re-consent must not silently stay enabled');
  console.log('  ✓ permission escalation on update re-triggers consent, does not inherit the old approval');

  /* 5. removePlugin() refuses to escape the plugins directory */
  var outsideDir = path.join(TMP, 'outside-target');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'sentinel.txt'), 'should not be deleted', 'utf8');

  var traversalResult = pluginLoader.removePlugin(TMP, '..' + path.sep + 'outside-target');
  assert.strictEqual(traversalResult.ok, false, 'a path-traversal folder name must be refused');
  assert.ok(fs.existsSync(path.join(outsideDir, 'sentinel.txt')), 'the outside file must still exist — traversal must not have deleted it');
  console.log('  ✓ removePlugin() refuses a path-traversal attempt, outside file untouched');

  /* And a legitimate removal of a plugin's own folder still works */
  var legitResult = pluginLoader.removePlugin(TMP, 'valid-plugin', 'com.test.valid');
  assert.strictEqual(legitResult.ok, true, 'removing a plugin\'s own folder must succeed');
  assert.ok(!fs.existsSync(path.join(TMP, 'plugins', 'valid-plugin')), 'the plugin folder must actually be gone');
  console.log('  ✓ removing a plugin\'s own folder works correctly');
}

try {
  run();
  console.log('\nALL PLUGIN LOADER TESTS PASSED');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
} catch (e) {
  console.error('\nPLUGIN LOADER TEST FAILED');
  console.error(e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
}
