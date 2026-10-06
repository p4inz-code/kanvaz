#!/usr/bin/env node
/* ============================================================
   Kanvaz — keep-on-top.js test (always-on-top vs other topmost apps, e.g. ZBrush)
   Usage: node test/keep-on-top-test.js
   Drives the module with a fake window and fake timers.
   ============================================================ */

var path = require('path');
var assert = require('assert');
var kot = require(path.join(__dirname, '..', 'src', 'keep-on-top.js'));

function fakeWindow(over) {
  var w = {
    visible: true, minimized: false, focused: false, onTop: false, destroyed: false,
    calls: [],
    isDestroyed: function() { return w.destroyed; },
    isVisible: function() { return w.visible; },
    isMinimized: function() { return w.minimized; },
    isFocused: function() { return w.focused; },
    isAlwaysOnTop: function() { return w.onTop; },
    setAlwaysOnTop: function(flag, level) { w.onTop = !!flag; w.calls.push(['setAlwaysOnTop', flag, level]); },
    setVisibleOnAllWorkspaces: function(flag, o) { w.calls.push(['setVisibleOnAllWorkspaces', flag, o]); },
    moveTop: function() { w.calls.push(['moveTop']); }
  };
  for (var k in (over || {})) w[k] = over[k];
  return w;
}
function make(win, platform) {
  var timers = [];
  var api = kot.create({
    getWindow: function() { return win; }, platform: platform || 'win32',
    setInterval: function(fn, ms) { var t = { fn: fn, ms: ms, cleared: false }; timers.push(t); return t; },
    clearInterval: function(t) { t.cleared = true; }
  });
  return { api: api, timers: timers };
}
function count(w, name) { return w.calls.filter(function(c) { return c[0] === name; }).length; }

function run() {
  /* the reported bug: another app grabbed the top of the stack and Kanvaz stayed underneath */
  var w = fakeWindow();
  var m = make(w);
  m.api.set(true);
  assert.strictEqual(w.onTop, true, 'set(true) turns always-on-top on');
  assert.strictEqual(m.api.hasWatchdog(), true, 'a watchdog runs while it is wanted');
  assert.strictEqual(m.timers[0].ms, kot.DEFAULT_INTERVAL_MS);
  w.focused = false;                            // ZBrush has focus
  var raised = m.api.raise();
  assert.strictEqual(raised, true);
  assert.strictEqual(count(w, 'moveTop'), 1, 'Kanvaz is raised above the other topmost window');
  m.timers[0].fn();                             // watchdog tick does the same
  assert.strictEqual(count(w, 'moveTop'), 2, 'the watchdog tick re-raises it');
  console.log('  ✓ losing the top of the stack to another app is corrected (raise + watchdog)');

  /* never fight the user or steal focus */
  w.focused = true;
  var before = count(w, 'moveTop');
  assert.strictEqual(m.api.raise(), false);
  assert.strictEqual(count(w, 'moveTop'), before, 'no raise while Kanvaz itself is focused');
  console.log('  ✓ nothing is done while Kanvaz is the focused window');

  /* the OS dropped the topmost flag */
  w.focused = false; w.onTop = false;
  var setsBefore = count(w, 'setAlwaysOnTop');
  m.api.raise();
  assert.strictEqual(w.onTop, true, 'a lost topmost flag is re-applied');
  assert.ok(count(w, 'setAlwaysOnTop') > setsBefore);
  console.log('  ✓ a lost always-on-top flag is re-applied');

  /* hidden / minimized / destroyed windows are left alone */
  w.minimized = true; var mt = count(w, 'moveTop'); m.api.raise();
  assert.strictEqual(count(w, 'moveTop'), mt, 'minimized: not raised');
  w.minimized = false; w.visible = false; m.api.raise();
  assert.strictEqual(count(w, 'moveTop'), mt, 'hidden: not raised');
  w.visible = true; w.destroyed = true;
  assert.doesNotThrow(function() { m.api.raise(); m.api.set(true); }, 'a destroyed window must not throw');
  console.log('  ✓ minimized, hidden and destroyed windows are never touched');

  /* turning it off really stops everything */
  var w2 = fakeWindow(); var m2 = make(w2);
  m2.api.set(true); m2.api.set(false);
  assert.strictEqual(w2.onTop, false);
  assert.strictEqual(m2.timers[0].cleared, true, 'watchdog is cleared when switched off');
  assert.strictEqual(m2.api.hasWatchdog(), false);
  w2.focused = false; assert.strictEqual(m2.api.raise(), false, 'not wanted: raise is a no-op');
  assert.strictEqual(count(w2, 'moveTop'), 0);
  m2.api.set(true); m2.api.set(true);
  assert.strictEqual(m2.timers.length, 2, 'repeated set(true) does not stack watchdogs');
  console.log('  ✓ switching it off stops the watchdog and raising; repeated on does not stack timers');

  /* macOS: floats over full-screen apps */
  var w3 = fakeWindow(); var m3 = make(w3, 'darwin');
  m3.api.set(true);
  assert.deepStrictEqual(w3.calls[0], ['setAlwaysOnTop', true, 'screen-saver']);
  assert.deepStrictEqual(w3.calls[1], ['setVisibleOnAllWorkspaces', true, { visibleOnFullScreen: true, skipTransformProcessType: true }]);
  m3.api.set(false);
  assert.deepStrictEqual(w3.calls[2], ['setAlwaysOnTop', false, 'normal']);
  var w4 = fakeWindow(); var m4 = make(w4, 'win32'); m4.api.set(true);
  assert.deepStrictEqual(w4.calls, [['setAlwaysOnTop', true, undefined]], 'Windows/Linux keep the plain call');
  console.log('  ✓ macOS uses the screen-saver level + visibleOnFullScreen; Windows/Linux keep the plain call');
}

try {
  run();
  console.log('\n  ALL KEEP-ON-TOP TESTS PASSED');
} catch (e) {
  console.error('\n  FAIL:', e && e.stack || e);
  process.exit(1);
}
