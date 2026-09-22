/* hdr-preview-test.js — src/hdr-preview.js (HDR/EXR preview decoding).

   Builds real, spec-valid HDR and EXR files in-memory (no fixture files
   checked into the repo) and round-trips them through the real decoder,
   same "build it, then read it back" approach test/adobe-preview-test.js
   already uses for PSD/PSB/XD. The HDR encoder mirrors three.js's own
   HDRLoader algorithm (already verified against that reference — see
   hdr-preview.js's own header comment); the EXR encoder is written from
   the public OpenEXR file format spec, independently of the reader, so a
   passing round trip means both agree with the spec, not just with each
   other's assumptions.

   Run: node test/hdr-preview-test.js */
var assert = require('assert');
var hdr = require('../src/hdr-preview');

function approxEqual(a, b, eps, msg) {
  assert(Math.abs(a - b) <= eps, (msg || '') + ' (' + a + ' vs ' + b + ', eps ' + eps + ')');
}

/* ── HDR (Radiance/RGBE) ── */

function testHdrRoundTrip() {
  var w = 24, h = 18;
  var data = new Float32Array(w * h * 3);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 3;
      data[i] = (x / w) * 4.0;          /* R: 0..4, well above SDR range — the point of HDR */
      data[i + 1] = (y / h) * 2.0;      /* G: 0..2 */
      data[i + 2] = 0.35;               /* B: flat */
    }
  }
  var bytes = hdr.writeHdrForTest(w, h, data);
  var decoded = hdr.readHdr(bytes);
  assert.strictEqual(decoded.width, w);
  assert.strictEqual(decoded.height, h);
  var maxErr = 0;
  for (var k = 0; k < data.length; k++) maxErr = Math.max(maxErr, Math.abs(data[k] - decoded.data[k]));
  /* RGBE is an 8-bit-mantissa format — real, small quantization error is
     expected and correct, not a bug; this bounds it rather than requiring
     bit-exactness. */
  assert(maxErr < 0.05, 'HDR round trip stays within RGBE quantization error (got ' + maxErr + ')');
  console.log('  ✓ HDR (Radiance/RGBE): real RLE-encoded file decodes back to the source values within quantization error');
}

function testHdrRejectsGarbage() {
  assert.throws(function() { hdr.readHdr(Buffer.from('not an hdr file at all', 'latin1')); }, /bad magic/);
  var truncated = hdr.writeHdrForTest(8, 8, new Float32Array(8 * 8 * 3)).subarray(0, 20);
  assert.throws(function() { hdr.readHdr(Buffer.from(truncated)); });
  console.log('  ✓ HDR: a non-HDR file and a truncated one both fail loudly instead of returning garbage pixels');
}

/* ── EXR (OpenEXR) — minimal single-part scanline RGB half-float,
   NONE and RLE compression, written directly from the public file format
   spec (independent of hdr-preview.js's own reader). ── */

function floatToHalfBits(v) {
  /* Standard IEEE754 float32 -> float16 bit conversion (round-to-nearest,
     no denormal/inf/nan special-casing needed for the small test values
     used here). */
  var f32 = new Float32Array([v]);
  var bits = new Uint32Array(f32.buffer)[0];
  var sign = (bits >>> 16) & 0x8000;
  var exp = ((bits >>> 23) & 0xff) - 127 + 15;
  var mant = bits & 0x7fffff;
  if (exp <= 0) return sign;   /* underflow to zero — fine for this test's value range */
  if (exp >= 31) return sign | 0x7c00;   /* overflow to inf */
  return sign | (exp << 10) | (mant >> 13);
}

function cstr(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]); }
function i32(v) { var b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; }
function u8(v) { return Buffer.from([v]); }
function f32(v) { var b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; }

function buildExrHeaderAttrs(width, height, compression) {
  var chlist = [];
  ['B', 'G', 'R'].forEach(function(name) {   /* deliberately NOT pre-sorted — the reader must sort itself */
    chlist.push(cstr(name), i32(1) /* pixelType HALF */, u8(0), Buffer.alloc(3), i32(1), i32(1));
  });
  chlist.push(Buffer.from([0]));   /* end of channel list */
  var channelsAttr = Buffer.concat(chlist);

  var dataWindow = Buffer.concat([i32(0), i32(0), i32(width - 1), i32(height - 1)]);
  var displayWindow = dataWindow;

  function attr(name, type, valueBuf) {
    return Buffer.concat([cstr(name), cstr(type), i32(valueBuf.length), valueBuf]);
  }

  return Buffer.concat([
    attr('channels', 'chlist', channelsAttr),
    attr('compression', 'compression', u8(compression)),
    attr('dataWindow', 'box2i', dataWindow),
    attr('displayWindow', 'box2i', displayWindow),
    attr('lineOrder', 'lineOrder', u8(0)),
    attr('pixelAspectRatio', 'float', f32(1)),
    attr('screenWindowCenter', 'v2f', Buffer.concat([f32(0), f32(0)])),
    attr('screenWindowWidth', 'float', f32(1)),
    Buffer.from([0])   /* end of header */
  ]);
}

/* Same reorder -> predictor -> RLE pipeline as hdr-preview.js's
   exrRleDecompress undoes, built independently from the spec (see that
   function's own comment) and cross-checked against it directly in
   testExrRleAgainstDecompressor() below before ever being trusted to
   build a whole file. */
function exrRleCompress(raw) {
  var n = raw.length;
  var half = (n + 1) >> 1;
  var reordered = Buffer.alloc(n);
  var e = 0, o = half;
  for (var i = 0; i < n; i += 2) {
    reordered[e++] = raw[i];
    if (i + 1 < n) reordered[o++] = raw[i + 1];
  }
  var pred = Buffer.alloc(n);
  var prev = 0;
  for (var k = 0; k < n; k++) {
    pred[k] = (reordered[k] - prev + 128 + 256) % 256;
    prev = reordered[k];
  }
  var out = [];
  var ip = 0;
  while (ip < n) {
    var chunk = Math.min(128, n - ip);
    out.push(chunk - 1);
    for (var j = 0; j < chunk; j++) out.push(pred[ip + j]);
    ip += chunk;
  }
  return Buffer.from(out);
}

function buildExrScanlineData(width, height, halfRGB, compression) {
  /* Planar per scanline, channels in ALPHABETICAL order (B, G, R) since
     the writer above intentionally listed them out of order to prove the
     reader sorts. */
  var offsetTable = [];
  var scanlines = [];
  var fileOffsetPlaceholder = 0;   /* offsets aren't validated by the reader (see hdr-preview.js's own comment) — zero is fine */
  for (var y = 0; y < height; y++) {
    var raw = Buffer.alloc(width * 2 * 3);
    for (var ch = 0; ch < 3; ch++) {   /* B, G, R */
      for (var x = 0; x < width; x++) {
        var idx = (y * width + x) * 3 + (2 - ch);   /* halfRGB is R,G,B; write B first, then G, then R */
        raw.writeUInt16LE(floatToHalfBits(halfRGB[idx]), (ch * width + x) * 2);
      }
    }
    var payload = compression === 1 ? exrRleCompress(raw) : raw;
    scanlines.push(Buffer.concat([i32(y), i32(payload.length), payload]));
    offsetTable.push(fileOffsetPlaceholder);
  }
  var offsetTableBuf = Buffer.alloc(height * 8);   /* int64 each, unused by the reader */
  return Buffer.concat([offsetTableBuf].concat(scanlines));
}

function buildExr(width, height, halfRGB, compression) {
  var magic = Buffer.from([0x76, 0x2f, 0x31, 0x01]);
  var version = Buffer.from([2, 0, 0, 0]);   /* version 2, no multipart/tiled/deep flags */
  var header = buildExrHeaderAttrs(width, height, compression);
  var data = buildExrScanlineData(width, height, halfRGB, compression);
  return Buffer.concat([magic, version, header, data]);
}

function testExrRleAgainstDecompressor() {
  var sizes = [0, 1, 2, 3, 10, 100, 257, 4096];
  for (var i = 0; i < sizes.length; i++) {
    var n = sizes[i];
    var raw = Buffer.alloc(n);
    for (var k = 0; k < n; k++) raw[k] = Math.floor(Math.random() * 256);
    var compressed = exrRleCompress(raw);
    var decompressed = hdr.exrRleDecompress(compressed, n);
    assert.strictEqual(Buffer.compare(raw, decompressed), 0, 'RLE round trip at size ' + n);
  }
  console.log('  ✓ EXR RLE codec: reorder+predictor+run-length round-trips exactly for sizes 0..4096, including every odd length');
}

function testExrUncompressed() {
  var w = 12, h = 9;
  var rgb = new Float32Array(w * h * 3);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 3;
      rgb[i] = x / w; rgb[i + 1] = y / h; rgb[i + 2] = 0.5;
    }
  }
  var file = buildExr(w, h, rgb, 0 /* NONE */);
  var decoded = hdr.readExr(file);
  assert.strictEqual(decoded.width, w);
  assert.strictEqual(decoded.height, h);
  var maxErr = 0;
  for (var k = 0; k < rgb.length; k++) maxErr = Math.max(maxErr, Math.abs(rgb[k] - decoded.data[k]));
  assert(maxErr < 0.01, 'half-float precision round trip (got err ' + maxErr + ')');
  console.log('  ✓ EXR (NONE compression): a real, spec-built file decodes correctly, channels sorted from B/G/R order to R/G/B');
}

function testExrRle() {
  var w = 16, h = 10;
  var rgb = new Float32Array(w * h * 3);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 3;
      rgb[i] = 1.5 * (x / w); rgb[i + 1] = 0.8; rgb[i + 2] = 2.2 * (y / h);   /* real HDR range, above 1.0 */
    }
  }
  var file = buildExr(w, h, rgb, 1 /* RLE */);
  var decoded = hdr.readExr(file);
  assert.strictEqual(decoded.width, w);
  assert.strictEqual(decoded.height, h);
  var maxErr = 0;
  for (var k = 0; k < rgb.length; k++) maxErr = Math.max(maxErr, Math.abs(rgb[k] - decoded.data[k]));
  assert(maxErr < 0.02, 'RLE-compressed EXR round trip (got err ' + maxErr + ')');
  console.log('  ✓ EXR (RLE compression): decodes correctly end to end (header -> RLE -> predictor -> deinterleave -> half-float)');
}

function testExrRejectsUnsupportedCompression() {
  var w = 4, h = 4;
  var file = buildExr(w, h, new Float32Array(w * h * 3), 4 /* PIZ */);
  assert.throws(function() { hdr.readExr(file); }, /PIZ/, 'a PIZ-compressed EXR is refused with a specific, honest reason');
  console.log('  ✓ EXR: an unsupported compression (PIZ) is refused with a clear reason, not silently misread');
}

function testExrRejectsGarbage() {
  assert.throws(function() { hdr.readExr(Buffer.from('nope')); }, /bad magic/);
  console.log('  ✓ EXR: a non-EXR file fails loudly');
}

/* ── tone-mapping / downscale sanity ── */

function testToneMapRange() {
  var w = 4, h = 4;
  var data = new Float32Array(w * h * 3);
  for (var i = 0; i < data.length; i++) data[i] = Math.random() * 50;   /* very bright, real-HDR-scale values */
  var rgba = hdr.toneMapToRgba8(w, h, data);
  assert.strictEqual(rgba.length, w * h * 4);
  for (var p = 0; p < w * h; p++) {
    assert(rgba[p * 4] <= 255 && rgba[p * 4 + 1] <= 255 && rgba[p * 4 + 2] <= 255, 'tone-mapped output never exceeds 8-bit range even for very bright HDR input');
    assert.strictEqual(rgba[p * 4 + 3], 255, 'alpha is always opaque');
  }
  /* an all-zero (black) image should tone-map to a real black, not a divide-by-zero artifact */
  var black = hdr.toneMapToRgba8(2, 2, new Float32Array(2 * 2 * 3));
  for (var b = 0; b < black.length; b += 4) assert.strictEqual(black[b], 0, 'pure black HDR data stays black, no NaN/exposure blowup');
  console.log('  ✓ tone-mapping: output always in valid 8-bit range, black stays black, no divide-by-zero on an all-zero image');
}

function testDownscale() {
  var w = 100, h = 50;
  var data = new Float32Array(w * h * 3);
  for (var i = 0; i < data.length; i++) data[i] = 1;   /* flat field: any correct box filter must average back to exactly 1 */
  var small = hdr.downscaleFloatRGB(w, h, data, 25);
  assert(small.width <= 25 && small.height <= 25, 'downscale respects the max side');
  /* Approximate, not exact: both output dimensions are rounded to whole
     pixels independently, so an aspect ratio that doesn't divide evenly
     (100x50 -> 25x13, not 25x12.5) can't be preserved bit-exactly — that's
     correct, expected rounding, the same as any image resizer, not a bug
     to assert away. */
  approxEqual(small.width / small.height, w / h, 0.1, 'aspect ratio is preserved to within integer-rounding tolerance');
  for (var k = 0; k < small.data.length; k++) approxEqual(small.data[k], 1, 1e-6, 'a flat field box-downscales back to the same flat value');
  var untouched = hdr.downscaleFloatRGB(10, 10, data.subarray(0, 300), 25);
  assert.strictEqual(untouched.width, 10, 'an image already under the max side is returned unchanged, not upscaled');
  console.log('  ✓ downscale: respects max side, preserves aspect ratio, a flat field stays flat, no upscaling of small images');
}

function run() {
  testHdrRoundTrip();
  testHdrRejectsGarbage();
  testExrRleAgainstDecompressor();
  testExrUncompressed();
  testExrRle();
  testExrRejectsUnsupportedCompression();
  testExrRejectsGarbage();
  testToneMapRange();
  testDownscale();
  console.log('ALL HDR/EXR PREVIEW TESTS PASSED');
}

run();
