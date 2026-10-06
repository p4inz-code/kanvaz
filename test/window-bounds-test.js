#!/usr/bin/env node
/* ============================================================
   Kanvaz — window-bounds.js test (remembered MoodLock window position)
   Usage: node test/window-bounds-test.js
   ============================================================ */

var path = require('path');
var assert = require('assert');
var wb = require(path.join(__dirname, '..', 'src', 'window-bounds.js'));

var ONE = [{ x: 0, y: 0, width: 1920, height: 1040 }];
var TWO = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 2560, height: 1400 }];

function run() {
  /* a normal rectangle on a connected display is kept */
  assert.deepStrictEqual(wb.sanitize({ x: 100, y: 80, width: 400, height: 300 }, ONE), { x: 100, y: 80, width: 400, height: 300 });
  console.log('  ✓ a reachable rectangle is returned unchanged');

  /* parked on the second monitor, which is still connected */
  assert.ok(wb.sanitize({ x: 3800, y: 900, width: 360, height: 260 }, TWO), 'second monitor position is valid while it exists');
  console.log('  ✓ a position on a second monitor is kept while that monitor exists');

  /* that monitor was unplugged: the saved spot is unreachable, so it must be dropped */
  assert.strictEqual(wb.sanitize({ x: 3800, y: 900, width: 360, height: 260 }, ONE), null, 'unplugged monitor: refuse');
  console.log('  ✓ a position on a monitor that is gone is refused (never restores an unreachable window)');

  /* only a sliver on screen is not enough to grab the window */
  assert.strictEqual(wb.sanitize({ x: 1900, y: 100, width: 400, height: 300 }, ONE), null, '20 px visible: refuse');
  assert.ok(wb.sanitize({ x: 1780, y: 100, width: 400, height: 300 }, ONE), '140 px visible: ok');
  console.log('  ✓ a rectangle with only a sliver on screen is refused; a usable part is enough');

  /* the minimum size is enforced */
  var small = wb.sanitize({ x: 50, y: 50, width: 10, height: 10 }, ONE);
  assert.strictEqual(small.width, wb.MIN_W);
  assert.strictEqual(small.height, wb.MIN_H);
  console.log('  ✓ tiny sizes are raised to the window minimum');

  /* garbage never gets through */
  [null, undefined, {}, { x: 'a', y: 0, width: 300, height: 300 }, { x: NaN, y: 0, width: 300, height: 300 }, 42, 'x']
    .forEach(function(g) { assert.strictEqual(wb.sanitize(g, ONE), null, 'must refuse ' + JSON.stringify(g)); });
  assert.strictEqual(wb.sanitize({ x: 0, y: 0, width: 300, height: 300 }, []), null, 'no displays: refuse');
  assert.strictEqual(wb.sanitize({ x: 0, y: 0, width: 300, height: 300 }, undefined), null, 'missing displays: refuse');
  console.log('  ✓ missing, malformed or non-numeric input is refused');

  /* fractional values from the OS are rounded */
  var r = wb.sanitize({ x: 10.6, y: 20.4, width: 400.5, height: 300.2 }, ONE);
  assert.deepStrictEqual(r, { x: 11, y: 20, width: 401, height: 300 });
  console.log('  ✓ fractional coordinates are rounded to whole pixels');
}

try {
  run();
  console.log('\n  ALL WINDOW BOUNDS TESTS PASSED');
} catch (e) {
  console.error('\n  FAIL:', e && e.stack || e);
  process.exit(1);
}
