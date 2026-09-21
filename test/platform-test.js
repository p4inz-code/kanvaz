#!/usr/bin/env node
/* platform-test.js — OS detection and shortcut wording (src/platform.js). */

var assert = require('assert');
var P = require('../src/platform');
var mac = function(t) { return P.macifyText(t); };

function run() {
  /* detection */
  assert.strictEqual(P.detect('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
  assert.strictEqual(P.detect('', 'Mozilla/5.0 (Macintosh)'), 'mac', 'user agent alone is enough');
  assert.strictEqual(P.detect('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'win');
  assert.strictEqual(P.detect('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
  assert.strictEqual(P.detect('', ''), 'win', 'unknown falls back to the Windows wording');
  console.log('  ✓ detects macOS, Windows and Linux');

  /* real shortcuts use Apple notation: ⌃⌥⇧⌘ order, no separators */
  assert.strictEqual(mac('Ctrl+S'), '⌘S');
  assert.strictEqual(mac('Ctrl + S'), '⌘S', 'spaced form too');
  assert.strictEqual(mac('Ctrl+Shift+S'), '⇧⌘S', 'Shift comes before Command, as on a Mac');
  assert.strictEqual(mac('Shift + I'), '⇧I');
  assert.strictEqual(mac('Ctrl+Alt+Shift+Z'), '⌥⇧⌘Z');
  assert.strictEqual(mac('Ctrl+Y'), '⌘Y');
  assert.strictEqual(mac('Ctrl + 1..9'), '⌘1..9', 'a key range stays a range');
  assert.strictEqual(mac('Ctrl+Enter'), '⌘↩');
  assert.strictEqual(mac('Ctrl+Backspace'), '⌘⌫');
  assert.strictEqual(mac('Ctrl+='), '⌘=');
  console.log('  ✓ shortcuts are written the Mac way (⇧⌘S), modifiers in ⌥⇧⌘ order');

  /* inside sentences and tooltips */
  assert.strictEqual(mac('Undo (Ctrl+Z)'), 'Undo (⌘Z)');
  assert.strictEqual(mac('Redo (Ctrl+Y)'), 'Redo (⌘Y)');
  assert.strictEqual(mac('Save (Ctrl+S), or Save As (Ctrl+Shift+S)'), 'Save (⌘S), or Save As (⇧⌘S)');
  console.log('  ✓ shortcuts inside tooltips and sentences are rewritten in place');

  /* descriptions keep their words */
  assert.strictEqual(mac('Alt + drag'), '⌥ drag');
  assert.strictEqual(mac('Ctrl+scroll'), '⌘ scroll');
  assert.strictEqual(mac('Ctrl + click'), '⌘ click');
  assert.strictEqual(mac('hold Ctrl to snap'), 'hold ⌘ to snap', 'a stray modifier word is still translated');
  console.log('  ✓ descriptions ("Alt + drag") keep their words with the symbol');

  /* nothing to change */
  ['Reset zoom', 'Press ? anytime', 'F', 'Escape to exit', 'Plain text', ''].forEach(function(t) {
    assert.strictEqual(mac(t), t, JSON.stringify(t) + ' unchanged');
  });
  assert.strictEqual(mac('Control key'), 'Control key', 'the word "Control" alone is not a shortcut');
  console.log('  ✓ text without shortcuts is left alone');

  /* the exported wording on the platform running the test is a no-op off macOS */
  if (P.current() !== 'mac') assert.strictEqual(P.label('Ctrl+Shift+S'), 'Ctrl+Shift+S', 'Windows/Linux wording is untouched');
  console.log('  ✓ Windows and Linux wording is untouched');

  /* every shortcut string the app actually shows converts without leaving "Ctrl" behind */
  var fs = require('fs'), path = require('path');
  var ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  var found = ui.match(/'(?:Ctrl|Shift|Alt)[^']{0,40}'/g) || [];
  var checked = 0;
  found.forEach(function(q) {
    var t = q.slice(1, -1);
    var m = mac(t);
    assert(!/\bCtrl\b/.test(m), 'no leftover "Ctrl" after converting ' + JSON.stringify(t) + ' -> ' + JSON.stringify(m));
    checked++;
  });
  assert(checked > 10, 'the shortcut list in ui.js was found and checked (' + checked + ')');
  console.log('  ✓ all ' + checked + ' shortcut labels in the shortcuts overlay convert cleanly');
}

try { run(); console.log('ALL PLATFORM TESTS PASSED'); }
catch (e) { console.log('PLATFORM TEST FAILED'); console.log(e && e.stack || e); process.exit(1); }
