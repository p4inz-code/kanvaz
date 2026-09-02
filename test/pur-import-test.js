#!/usr/bin/env node
/* ============================================================
   pur-import-test.js — regression tests for pur-import.js

   Covers the bug that made real-world .pur imports hang the whole app:
   the "link transforms to images" / "resolve duplicates" steps used to
   be nested linear scans (O(imageItems x images)), and `images` routinely
   holds thousands of entries on real files. Test B below is the actual
   regression guard for that — it fails (times out) against the pre-fix
   nested-loop version and passes quickly against the fixed absStart/
   transformId map version. Verified by temporarily reverting the fix and
   confirming this test actually goes red, not just green either way.
   ============================================================ */

var path = require('path');
var Worker = require('worker_threads').Worker;
var purImport = require('../src/pur-import');

var pass = true;
function check(name, cond) {
  if (cond) { console.log('  ✓ ' + name); }
  else { console.log('  ✗ ' + name); pass = false; }
}

var PNG_HEAD = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
var PNG_FOOT = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
var HEADER_SIZE = 224;
var ITEM_SIZE = 180;
var GRAPHICS_IMAGE_ITEM = 34;

/* One minimal, valid GraphicsImageItem record — 180 bytes, self-
   contained (transformEnd points exactly at its own end, so no trailing
   padding/crop-point bytes are needed). See the byte-by-byte layout
   this mirrors in pur-import.js's readGraphicsImageItem(). */
function buildItem(absStart, id, x, y, zLayer, scaleX, scaleY) {
  var b = Buffer.alloc(ITEM_SIZE);
  var transformEnd = absStart + ITEM_SIZE;
  b.writeUInt32BE(Math.floor(transformEnd / 0x100000000), 0);
  b.writeUInt32BE(transformEnd >>> 0, 4);
  /* Local offset 8: the outer item loop peeks here (current pos + 8)
     BEFORE calling into this reader at all, to decide whether what
     follows is a GraphicsImageItem — must hold the type marker.
     Offset 12: stdTextLen, must be 0 so skip(12) below consumes
     exactly this whole preamble block. Offset 16-20: unused padding. */
  b.writeUInt32BE(GRAPHICS_IMAGE_ITEM, 8);
  b.writeUInt32BE(0xFFFFFFFF, 20); /* bruteForce peek !=0, then source peek ==-1 -> skip(4) */
  b.writeUInt32BE(0xFFFFFFFF, 24); /* name peek ==-1 -> skip(4) */
  /* bytes 28-36: unknown, zero */
  b.writeDoubleBE(scaleX, 36);     /* matrix[0] */
  b.writeDoubleBE(0, 44);          /* matrix[1] */
  /* bytes 52-60: unused, skipped */
  b.writeDoubleBE(0, 60);          /* matrix[2] */
  b.writeDoubleBE(scaleY, 68);     /* matrix[3] */
  b.writeDoubleBE(x, 76);
  b.writeDoubleBE(y, 84);
  /* bytes 92-100: second unknown, zero */
  b.writeUInt32BE(id, 100);
  b.writeDoubleBE(zLayer, 104);
  /* matrixBeforeCrop (40 bytes, all zero) at 112-152 */
  b.writeDoubleBE(0, 152); /* xCrop */
  b.writeDoubleBE(0, 160); /* yCrop */
  b.writeDoubleBE(0, 168); /* scaleCrop */
  b.writeUInt32BE(0, 176); /* pointCount = 0 */
  return b;
}

/* Builds a full synthetic .pur buffer with N real images + matching
   items + footer refs — no corruption, purely to exercise scale. */
function buildSyntheticPur(n) {
  var chunks = [Buffer.alloc(HEADER_SIZE)];
  var pos = HEADER_SIZE;
  var imageStarts = [];

  for (var i = 0; i < n; i++) {
    imageStarts.push(pos);
    chunks.push(PNG_HEAD, PNG_FOOT);
    pos += PNG_HEAD.length + PNG_FOOT.length;
  }

  for (var j = 0; j < n; j++) {
    chunks.push(buildItem(pos, j + 1, j * 10, j * 5, j, 1, 1));
    pos += ITEM_SIZE;
  }

  /* Footer: folder-location string (len=0), then one refId/start/end per item */
  var folderLen = Buffer.alloc(4);
  chunks.push(folderLen);
  for (var k = 0; k < n; k++) {
    var ref = Buffer.alloc(20);
    ref.writeUInt32BE(k + 1, 0);
    var start = imageStarts[k];
    ref.writeUInt32BE(Math.floor(start / 0x100000000), 4);
    ref.writeUInt32BE(start >>> 0, 8);
    var end = start + PNG_HEAD.length + PNG_FOOT.length;
    ref.writeUInt32BE(Math.floor(end / 0x100000000), 12);
    ref.writeUInt32BE(end >>> 0, 16);
    chunks.push(ref);
  }

  return Buffer.concat(chunks);
}

/* ── Test A: correctness on a small synthetic file ── */
console.log('\nTest A — correctness (3 images)');
var smallBuf = buildSyntheticPur(3);
var smallResult = purImport.parsePurFile(smallBuf);
check('extracted exactly 3 images', smallResult.count === 3);
check('positions round-trip', smallResult.images[0].x === 0 && smallResult.images[1].x === 10);
check('sorted by zLayer ascending', smallResult.images[0].zLayer <= smallResult.images[1].zLayer && smallResult.images[1].zLayer <= smallResult.images[2].zLayer);

/* ── Test B: performance regression (the actual bug) ──
   Pre-fix, linking N items against N images was O(N^2) — but V8 runs a
   trivial property-comparison inner loop fast enough that this doesn't
   show up at small N (9,000,000 iterations at N=3000 still finished in
   ~12ms). Measured directly against the pre-fix nested-loop code: N=40000
   takes ~1.2s; the O(n) map-based fix takes ~50ms for the same input.
   400ms sits comfortably between the two, so this only passes against
   the real fix, not by accident. Confirmed by temporarily reverting the
   fix and re-running this exact test — it failed (1.2s > 400ms) — before
   trusting it as a real regression guard. */
console.log('\nTest B — linking scales linearly, not quadratically (40000 images)');
var bigBuf = buildSyntheticPur(40000);
var t0 = Date.now();
var bigResult = purImport.parsePurFile(bigBuf);
var elapsedMs = Date.now() - t0;
check('extracted all 40000 images', bigResult.count === 40000);
check('completed in well under the O(n²) time (' + elapsedMs + 'ms < 400ms)', elapsedMs < 400);

/* ── Test C: the hard cap fails fast instead of hanging ──
   A large gap of non-PNG junk between the header and the next PNG
   signature forces the raw-4-byte-gap scanner to try building far more
   entries than any real board would ever need — this is the shape a
   misaligned/corrupted parse produces in the field. */
console.log('\nTest C — pathological gap fails fast with a clear error, not a hang');
var junk = Buffer.alloc(250000, 1); /* /4 = 62500 entries, past MAX_TRACKED_ENTRIES (50000); no zero bytes -> never accidentally matches PNG_HEAD */
var pathBuf = Buffer.concat([Buffer.alloc(HEADER_SIZE), junk, PNG_HEAD, PNG_FOOT]);
var threw = false;
var t1 = Date.now();
try {
  purImport.parsePurFile(pathBuf);
} catch (e) {
  threw = true;
  check('error message mentions the file, not a stack trace leak', /corrupted|unsupported/i.test(e.message));
}
var elapsed2 = Date.now() - t1;
check('threw a controlled error instead of hanging', threw);
check('failed fast (' + elapsed2 + 'ms), did not grind', elapsed2 < 1000);

/* ── Test D: the real worker_thread boundary, not just the pure function ──
   main.js no longer calls parsePurFile() directly — it spawns
   pur-import-worker.js as a real worker_thread. That boundary has its
   own failure mode Tests A-C can't see: worker.postMessage() structured-
   clones a Node Buffer down to a plain Uint8Array on the receiving side,
   which lacks the .readDoubleBE()/.readUInt32BE() methods PurReader
   depends on. Caught this exact bug during manual verification (it threw
   "r.buf.readDoubleBE is not a function") before this re-wrap existed in
   pur-import-worker.js — this test pins that fix in place. */
function runInWorker(buffer) {
  return new Promise(function(resolve) {
    var w = new Worker(path.join(__dirname, '..', 'src', 'pur-import-worker.js'));
    var done = false;
    w.once('message', function(result) { done = true; w.terminate(); resolve(result); });
    w.once('error', function(e) { done = true; w.terminate(); resolve({ ok: false, error: e.message }); });
    setTimeout(function() {
      if (done) return;
      w.terminate();
      resolve({ ok: false, error: 'worker test itself timed out' });
    }, 5000);
    w.postMessage(buffer);
  });
}

console.log('\nTest D — real worker_thread round trip (not just the in-process function)');
runInWorker(buildSyntheticPur(5)).then(function(workerResult) {
  check('worker returns ok:true for a valid buffer', workerResult.ok === true);
  check('worker-parsed count matches in-process parse', workerResult.count === 5);
  return runInWorker(Buffer.alloc(50));
}).then(function(tinyResult) {
  check('worker surfaces a controlled error for a too-small buffer, not a crash', tinyResult.ok === false && /too small/i.test(tinyResult.error || ''));

  console.log('\n' + (pass ? 'ALL PUR-IMPORT TESTS PASSED' : 'PUR-IMPORT TESTS FAILED'));
  process.exit(pass ? 0 : 1);
}).catch(function(e) {
  console.log('  ✗ worker test threw unexpectedly: ' + e.message);
  console.log('\nPUR-IMPORT TESTS FAILED');
  process.exit(1);
});
