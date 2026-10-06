/* window-bounds.js — validates a remembered window rectangle before it is applied.

   MoodLock remembers where its (usually small) window sits so it can be parked once, for
   example in a corner of the second monitor, and come back there next time. A saved rectangle
   can be stale: the monitor it was on may be unplugged or the resolution may have changed, and
   restoring it blindly would put the window somewhere that cannot be seen or reached.
   sanitize() therefore only returns a rectangle that still overlaps a real display's work area
   by a usable amount, and clamps the size to the window's minimum.

   Node-only, no electron require, so test/window-bounds-test.js can run it.
   ES5/var-only like the rest of src/. */

var MIN_W = 220;
var MIN_H = 160;
var MIN_VISIBLE_W = 120;
var MIN_VISIBLE_H = 60;

function isNum(n) { return typeof n === 'number' && isFinite(n); }

function isBounds(b) {
  return !!b && isNum(b.x) && isNum(b.y) && isNum(b.width) && isNum(b.height);
}

function overlap(a, b) {
  var w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  var h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { w: Math.max(0, w), h: Math.max(0, h) };
}

/* b: {x,y,width,height} from disk or from getBounds(); workAreas: array of {x,y,width,height}.
   Returns a cleaned rectangle, or null when it is unusable or not reachable on any display. */
function sanitize(b, workAreas) {
  if (!isBounds(b)) return null;
  var out = {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(MIN_W, Math.round(b.width)),
    height: Math.max(MIN_H, Math.round(b.height))
  };
  var areas = workAreas || [];
  for (var i = 0; i < areas.length; i++) {
    if (!isBounds(areas[i])) continue;
    var o = overlap(out, areas[i]);
    if (o.w >= MIN_VISIBLE_W && o.h >= MIN_VISIBLE_H) return out;
  }
  return null;
}

module.exports = {
  MIN_W: MIN_W,
  MIN_H: MIN_H,
  sanitize: sanitize,
  isBounds: isBounds
};
