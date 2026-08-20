#!/usr/bin/env node
/* ============================================================
   Kanvaz — commands.js registry test
   Verifies registerCommand's validation degrades gracefully instead of
   throwing, getPaletteCommands() correctly filters showInPalette:false
   entries, runCommand() isolates a throwing command instead of taking
   the caller down with it, and fuzzyScore() matches/ranks the way the
   Command Palette (Ctrl+K) relies on. Requires commands.js directly —
   its registry logic has zero DOM dependency (see the guarded
   window/module export at the bottom of that file), only the palette
   UI functions this test never calls do.
   Usage: node test/command-registry-test.js
   ============================================================ */

var path = require('path');
var assert = require('assert');
var KanvazCommands = require(path.join(__dirname, '..', 'src', 'commands.js'));

function run() {
  /* 1. A well-formed command registers and is retrievable */
  var ok = KanvazCommands.registerCommand('test.ping', {
    label: 'Ping',
    run: function() {}
  });
  assert.strictEqual(ok, true, 'a well-formed command must register successfully');
  var cmd = KanvazCommands.getCommand('test.ping');
  assert.ok(cmd, 'registered command must be retrievable by id');
  assert.strictEqual(cmd.label, 'Ping');
  assert.strictEqual(cmd.showInPalette, true, 'showInPalette defaults to true when not specified');
  console.log('  ✓ well-formed command registers and defaults correctly');

  /* 2. Missing id / missing label / missing run all degrade gracefully */
  assert.strictEqual(KanvazCommands.registerCommand('', { label: 'x', run: function() {} }), false, 'empty id must be rejected');
  assert.strictEqual(KanvazCommands.registerCommand('test.nolabel', { run: function() {} }), false, 'missing label must be rejected');
  assert.strictEqual(KanvazCommands.registerCommand('test.norun', { label: 'x' }), false, 'missing run() must be rejected');
  assert.strictEqual(KanvazCommands.getCommand('test.nolabel'), null, 'a rejected command must not appear in the registry');
  console.log('  ✓ malformed command definitions rejected without throwing');

  /* 3. showInPalette:false is excluded from getPaletteCommands() but
     still directly runnable via runCommand() — a context-menu-only
     command (contextMenu:'card', showInPalette:false) should never
     clutter Ctrl+K. */
  KanvazCommands.registerCommand('test.hidden', {
    label: 'Hidden From Palette',
    showInPalette: false,
    run: function() {}
  });
  var paletteIds = KanvazCommands.getPaletteCommands().map(function(c) { return c.id; });
  assert.ok(paletteIds.indexOf('test.hidden') === -1, 'showInPalette:false must be excluded from the palette list');
  assert.ok(paletteIds.indexOf('test.ping') !== -1, 'a default-visibility command must appear in the palette list');
  assert.ok(KanvazCommands.runCommand('test.hidden', {}), 'a palette-hidden command must still be directly runnable');
  console.log('  ✓ showInPalette:false hides from the palette without blocking runCommand()');

  /* 4. runCommand() isolates a throwing command's own error — the
     caller (e.g. the palette's execSelected()) must not also throw. */
  KanvazCommands.registerCommand('test.throws', {
    label: 'Throws',
    run: function() { throw new Error('boom'); }
  });
  assert.doesNotThrow(function() { KanvazCommands.runCommand('test.throws', {}); }, 'a throwing command must not propagate out of runCommand()');
  console.log('  ✓ a throwing command is isolated, not propagated');

  /* 5. runCommand() on an unknown id returns false, doesn't throw */
  assert.strictEqual(KanvazCommands.runCommand('test.doesNotExist', {}), false, 'running an unregistered id must return false');
  console.log('  ✓ running an unknown command id is a safe no-op');

  /* 6. fuzzyScore — ordered-subsequence matching, the algorithm the
     palette's live filter relies on */
  assert.strictEqual(KanvazCommands.fuzzyScore('', 'Save Board'), 0, 'an empty query matches everything with score 0');
  assert.notStrictEqual(KanvazCommands.fuzzyScore('sb', 'Save Board'), null, '"sb" must match "Save Board" as an ordered subsequence');
  assert.strictEqual(KanvazCommands.fuzzyScore('xyz', 'Save Board'), null, 'a non-subsequence query must not match');
  assert.strictEqual(KanvazCommands.fuzzyScore('zzz', ''), null, 'empty text never matches a non-empty query');
  var tight = KanvazCommands.fuzzyScore('cmd', 'cmd palette');
  var loose = KanvazCommands.fuzzyScore('cmd', 'create media document');
  assert.ok(tight !== null && loose !== null, 'both should still match as subsequences');
  assert.ok(tight < loose, 'a tighter (less gappy) subsequence match must score lower (better) than a spread-out one');
  console.log('  ✓ fuzzyScore matches ordered subsequences and ranks tighter matches better');

  /* 7. Re-registering the same id overwrites rather than duplicating —
     getAllCommands() must not grow on repeated registration (a plugin
     hot-reload, or "Reload plugins" dev-mode workflow, re-runs a
     plugin's whole entry script, so registerCommand() gets called again
     with the same id every time). */
  var before = KanvazCommands.getAllCommands().length;
  KanvazCommands.registerCommand('test.ping', { label: 'Ping v2', run: function() {} });
  var after = KanvazCommands.getAllCommands().length;
  assert.strictEqual(after, before, 're-registering an existing id must overwrite, not duplicate');
  assert.strictEqual(KanvazCommands.getCommand('test.ping').label, 'Ping v2', 'the overwritten definition must win');
  console.log('  ✓ re-registering an id overwrites in place instead of duplicating');

  console.log('\nALL COMMAND REGISTRY TESTS PASSED\n');
}

run();
