/* keep-on-top.js — makes "Always on top" actually stay on top of OTHER apps.

   Bug (reported with ZBrush, 2026-10): main.js only ever called
   mainWindow.setAlwaysOnTop(flag) once. On Windows every always-on-top window
   lives in one "topmost" band that is stacked by most recent activation, so as
   soon as a 3D/paint app such as ZBrush takes focus and raises its own window
   into that band (full-screen style apps do this), Kanvaz ends up underneath
   and nothing ever brought it back. On macOS a plain always-on-top window also
   does not float over a full-screen app at all.

   Fix: while "always on top" is wanted, re-assert it whenever Kanvaz loses
   focus (raise() is moveTop(), which does NOT take focus away from the app
   the user is working in) and on a light watchdog interval, and on macOS use
   the 'screen-saver' level with visibleOnFullScreen so it also floats over
   full-screen apps.

   Node-only apart from the window object it is handed, so
   test/keep-on-top-test.js can drive it with a fake window.
   ES5/var-only like the rest of src/. */

var DEFAULT_INTERVAL_MS = 500;

/* opts:
   getWindow:   function returning the BrowserWindow (or null)
   platform:    process.platform
   setInterval / clearInterval: injectable for tests
   intervalMs:  watchdog period */
function create(opts) {
  opts = opts || {};
  var getWindow = opts.getWindow;
  var platform = opts.platform || process.platform;
  var setIntervalFn = opts.setInterval || setInterval;
  var clearIntervalFn = opts.clearInterval || clearInterval;
  var intervalMs = opts.intervalMs || DEFAULT_INTERVAL_MS;

  var wanted = false;
  var timer = null;

  function usable(w) {
    return !!w && !(w.isDestroyed && w.isDestroyed());
  }

  function applyFlag(w, flag) {
    try {
      if (platform === 'darwin') {
        /* 'screen-saver' + visibleOnFullScreen is what lets a window float over a
           full-screen app on macOS; skipTransformProcessType keeps the Dock icon. */
        w.setAlwaysOnTop(flag, flag ? 'screen-saver' : 'normal');
        if (w.setVisibleOnAllWorkspaces) {
          w.setVisibleOnAllWorkspaces(flag, { visibleOnFullScreen: flag, skipTransformProcessType: true });
        }
      } else {
        w.setAlwaysOnTop(flag);
      }
    } catch (e) { /* a window mid-teardown: nothing useful to do */ }
  }

  /* Put the window back on top without taking focus from whatever the user is using. */
  function raise() {
    if (!wanted) return false;
    var w = getWindow();
    if (!usable(w)) return false;
    if (!w.isVisible() || w.isMinimized()) return false;
    if (!w.isAlwaysOnTop()) applyFlag(w, true);
    if (!w.isFocused()) {
      try { w.moveTop(); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }

  function startWatchdog() {
    if (timer) return;
    timer = setIntervalFn(raise, intervalMs);
    if (timer && timer.unref) timer.unref();
  }

  function stopWatchdog() {
    if (!timer) return;
    clearIntervalFn(timer);
    timer = null;
  }

  function set(flag) {
    wanted = !!flag;
    var w = getWindow();
    if (usable(w)) applyFlag(w, wanted);
    if (wanted) startWatchdog(); else stopWatchdog();
  }

  return {
    set: set,
    raise: raise,
    isWanted: function() { return wanted; },
    hasWatchdog: function() { return !!timer; }
  };
}

module.exports = { create: create, DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS };
