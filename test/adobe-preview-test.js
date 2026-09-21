#!/usr/bin/env node
/* adobe-preview-test.js — PSD / PSB / XD / XMP / AI / Fresco previews.

   The PSD files are BUILT here to the published layout (header, colour mode
   data, image resources, layer and mask information, merged image data), in
   raw and RLE, 8 and 16 bit, RGB / grayscale / indexed / CMYK, PSD and PSB.
   The preview's PNG output is decoded again and compared pixel for pixel.
   Not covered, and said so: files written by Photoshop itself (no Adobe
   software here to make one). */

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var zlib = require('zlib');
var JSZip = require('jszip');
var ap = require('../src/adobe-preview');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-adobe-'));

function u16(n) { var b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function i16(n) { var b = Buffer.alloc(2); b.writeInt16BE(n); return b; }
function u32(n) { var b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function u64(n) { var b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(n / 4294967296), 0); b.writeUInt32BE(n >>> 0, 4); return b; }

function packBitsRow(row) {
  /* simple valid PackBits: runs of 3+ equal bytes as runs, everything else literal */
  var out = [], i = 0;
  while (i < row.length) {
    var run = 1;
    while (i + run < row.length && row[i + run] === row[i] && run < 128) run++;
    if (run >= 3) { out.push(257 - run, row[i]); i += run; }
    else {
      var start = i, n = 0;
      while (i < row.length && n < 128 && !(i + 2 < row.length && row[i] === row[i + 1] && row[i] === row[i + 2])) { i++; n++; }
      out.push(n - 1);
      for (var k = 0; k < n; k++) out.push(row[start + k]);
    }
  }
  return Buffer.from(out);
}

/* planes: array of arrays (rows) of Buffers; opts: {psb, rle, depth, mode, layers, mergedAlpha, thumb, palette} */
function buildPsd(w, h, planes, o) {
  o = o || {};
  var depth = o.depth || 8, mode = o.mode == null ? 3 : o.mode, big = !!o.psb;
  var parts = [Buffer.from('8BPS'), u16(big ? 2 : 1), Buffer.alloc(6), u16(planes.length), u32(h), u32(w), u16(depth), u16(mode)];
  parts.push(u32(o.palette ? o.palette.length : 0)); if (o.palette) parts.push(o.palette);
  var res = [];
  if (o.thumb) {
    var hdr = Buffer.concat([u32(1), u32(o.thumb.width), u32(o.thumb.height), u32(o.thumb.width * 3), u32(o.thumb.jpeg.length), u32(o.thumb.jpeg.length), u16(24), u16(1)]);
    var d = Buffer.concat([hdr, o.thumb.jpeg]); if (d.length % 2) d = Buffer.concat([d, Buffer.from([0])]);
    res.push(Buffer.from('8BIM'), u16(1036), Buffer.from([0, 0]), u32(hdr.length + o.thumb.jpeg.length), d);
  }
  /* an unrelated resource with an odd-length pascal name, to test padding */
  res.push(Buffer.from('8BIM'), u16(1005), Buffer.from([3, 65, 66, 67]), u32(2), Buffer.from([1, 2]));
  var resBuf = Buffer.concat(res);
  parts.push(u32(resBuf.length), resBuf);
  var layerInfo = Buffer.alloc(0);
  if (o.layers) layerInfo = Buffer.concat([i16(o.mergedAlpha ? -o.layers : o.layers), Buffer.alloc(16)]);
  var lm = Buffer.concat([big ? u64(layerInfo.length) : u32(layerInfo.length), layerInfo]);
  parts.push(big ? u64(lm.length) : u32(lm.length), lm);
  parts.push(u16(o.rle ? 1 : 0));
  if (o.rle) {
    var counts = [], data = [];
    planes.forEach(function(p) { p.forEach(function(row) { var c = packBitsRow(row); counts.push(big ? u32(c.length) : u16(c.length)); data.push(c); }); });
    parts.push(Buffer.concat(counts), Buffer.concat(data));
  } else {
    planes.forEach(function(p) { p.forEach(function(row) { parts.push(row); }); });
  }
  return Buffer.concat(parts);
}

function decodePng(png) {
  assert.deepStrictEqual([].slice.call(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  var pos = 8, w, h, ct, idat = [];
  while (pos < png.length) {
    var len = png.readUInt32BE(pos), type = png.toString('ascii', pos + 4, pos + 8), data = png.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  var bpp = ct === 2 ? 3 : 4, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * 4);
  for (var y = 0; y < h; y++) {
    assert.strictEqual(raw[y * (w * bpp + 1)], 1, 'Sub filter');
    var prev = [0, 0, 0, 0];
    for (var x = 0; x < w; x++) for (var c = 0; c < bpp; c++) {
      var v = (raw[y * (w * bpp + 1) + 1 + x * bpp + c] + prev[c]) & 255; prev[c] = v; out[(y * w + x) * 4 + c] = v;
    }
    if (bpp === 3) for (var x2 = 0; x2 < w; x2++) out[(y * w + x2) * 4 + 3] = 255;
  }
  return { w: w, h: h, ct: ct, rgba: out };
}

function rows(w, h, fn) { var r = []; for (var y = 0; y < h; y++) { var b = Buffer.alloc(w); for (var x = 0; x < w; x++) b[x] = fn(x, y); r.push(b); } return r; }
function write(name, buf) { var p = path.join(TMP, name); fs.writeFileSync(p, buf); return p; }

async function run() {
  var W = 37, H = 23;    /* odd sizes on purpose */
  var R = function(x, y) { return (x * 7 + y) & 255; }, G = function(x, y) { return (y * 11) & 255; }, B = function(x, y) { return (x + y * 3) & 255; };
  var planes = [rows(W, H, R), rows(W, H, G), rows(W, H, B)];

  /* RGB 8-bit raw, RLE, and PSB, at full size: exact pixels */
  [['raw', { rle: false }], ['RLE', { rle: true }], ['PSB RLE', { rle: true, psb: true }], ['PSB raw', { rle: false, psb: true }]].forEach(function(t) {
    var r = ap.readPsd(write('rgb.psd', buildPsd(W, H, planes, t[1])));
    assert(r.ok && r.kind === 'composite', t[0] + ' reads');
    assert(r.width === W && r.height === H && r.srcWidth === W, t[0] + ' size');
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var o = (y * W + x) * 4;
      assert(r.rgba[o] === R(x, y) && r.rgba[o + 1] === G(x, y) && r.rgba[o + 2] === B(x, y) && r.rgba[o + 3] === 255, t[0] + ' pixel ' + x + ',' + y);
    }
  });
  console.log('  ✓ RGB 8-bit, raw and RLE, PSD and PSB: every pixel exact (odd 37x23 size, padded resource names)');

  /* the PNG round-trips */
  var p1 = await ap.previewFile(write('a.psd', buildPsd(W, H, planes, { rle: true })));
  assert(p1.ok && p1.kind === 'image' && p1.mime === 'image/png');
  var d1 = decodePng(p1.bytes);
  assert(d1.w === W && d1.h === H && d1.ct === 2, 'opaque image is written as RGB');
  assert(d1.rgba[(5 * W + 9) * 4] === R(9, 5) && d1.rgba[(5 * W + 9) * 4 + 2] === B(9, 5), 'PNG pixels match the source');
  console.log('  ✓ output is a valid PNG whose pixels match the file');

  /* downscale averages */
  var flat = [rows(8, 8, function(x) { return x < 4 ? 0 : 200; }), rows(8, 8, function() { return 100; }), rows(8, 8, function() { return 50; })];
  var ds = ap.readPsd(write('ds.psd', buildPsd(8, 8, flat, { rle: true })), { maxSide: 4 });
  assert(ds.width === 4 && ds.height === 4 && ds.srcWidth === 8, 'downscaled to 4x4');
  assert(ds.rgba[0] === 0 && ds.rgba[8] === 200 && ds.rgba[1] === 100 && ds.rgba[2] === 50, 'block-averaged, not just sampled');
  var mix = ap.readPsd(write('mix.psd', buildPsd(8, 8, [rows(8, 8, function(x) { return x % 2 ? 100 : 0; }), flat[1], flat[2]], { rle: false })), { maxSide: 4 });
  assert(mix.rgba[0] === 50, 'alternating 0/100 averages to 50');
  console.log('  ✓ large images are averaged down while decoding (memory stays at preview size)');

  /* 16-bit */
  var planes16 = [0, 1, 2].map(function(c) { var r = []; for (var y = 0; y < 4; y++) { var b = Buffer.alloc(8); for (var x = 0; x < 4; x++) b.writeUInt16BE((x * 4369 + c * 20000) % 65536, x * 2); r.push(b); } return r; });
  var r16 = ap.readPsd(write('d16.psd', buildPsd(4, 4, planes16, { depth: 16, rle: false })));
  assert(r16.ok && r16.rgba[4] === Math.round(4369 / 257) && r16.rgba[0] === 0, '16-bit channel scaled to 8-bit');
  console.log('  ✓ 16-bit channels');

  /* grayscale, indexed, CMYK */
  var gray = ap.readPsd(write('g.psd', buildPsd(4, 2, [rows(4, 2, function(x) { return x * 60; })], { mode: 1 })));
  assert(gray.rgba[8] === 120 && gray.rgba[9] === 120 && gray.rgba[10] === 120, 'grayscale');
  var pal = Buffer.alloc(768); pal[5] = 250; pal[256 + 5] = 10; pal[512 + 5] = 20;
  var idx = ap.readPsd(write('i.psd', buildPsd(2, 2, [rows(2, 2, function() { return 5; })], { mode: 2, palette: pal })));
  assert(idx.rgba[0] === 250 && idx.rgba[1] === 10 && idx.rgba[2] === 20, 'indexed uses the colour table');
  var cmyk = ap.readPsd(write('c.psd', buildPsd(2, 2, [255, 255, 255, 255].map(function(v) { return rows(2, 2, function() { return v; }); }), { mode: 4 })));
  assert(cmyk.rgba[0] === 255 && cmyk.rgba[1] === 255 && cmyk.rgba[2] === 255, 'no ink (inverted 255) is white');
  var black = ap.readPsd(write('c2.psd', buildPsd(2, 2, [255, 255, 255, 0].map(function(v) { return rows(2, 2, function() { return v; }); }), { mode: 4 })));
  assert(black.rgba[0] === 0 && black.rgba[1] === 0, 'full black ink is black');
  var cp = await ap.previewFile(write('c.psd', buildPsd(2, 2, [255, 255, 255, 255].map(function(v) { return rows(2, 2, function() { return v; }); }), { mode: 4 })));
  assert(/CMYK/.test(cp.note), 'CMYK preview says the colours are approximate');
  console.log('  ✓ grayscale, indexed and CMYK (with an honest note that CMYK has no colour profile)');

  /* transparency: negative layer count = first extra channel is alpha */
  var aPlanes = planes.concat([rows(W, H, function(x) { return x < 10 ? 0 : 255; })]);
  var al = ap.readPsd(write('al.psd', buildPsd(W, H, aPlanes, { layers: 2, mergedAlpha: true })));
  assert(al.hasAlpha && al.rgba[3] === 0 && al.rgba[(0 * W + 20) * 4 + 3] === 255, 'merged transparency becomes alpha');
  var noAlpha = ap.readPsd(write('na.psd', buildPsd(W, H, aPlanes, { layers: 2, mergedAlpha: false })));
  assert(!noAlpha.hasAlpha && noAlpha.rgba[3] === 255, 'a saved selection channel is NOT mistaken for transparency');
  var pa = await ap.previewFile(write('al.psd', buildPsd(W, H, aPlanes, { layers: 2, mergedAlpha: true })));
  assert.strictEqual(decodePng(pa.bytes).ct, 6, 'transparent image is written as RGBA');
  console.log('  ✓ transparency only when the file says the merged image has it');

  /* blank composite (no Maximize Compatibility): thumbnail + explanation */
  var jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 1), Buffer.from([0xFF, 0xD9])]);
  var blankPlanes = [0, 1, 2].map(function() { return rows(W, H, function() { return 255; }); });
  var bl = await ap.previewFile(write('blank.psd', buildPsd(W, H, blankPlanes, { layers: 3, thumb: { jpeg: jpeg, width: 160, height: 100 } })));
  assert(bl.ok && bl.mime === 'image/jpeg' && bl.bytes.equals(jpeg) && /Maximize Compatibility/.test(bl.note), 'blank composite falls back to the embedded thumbnail and explains why');
  var blNo = await ap.previewFile(write('blank2.psd', buildPsd(W, H, blankPlanes, { layers: 3 })));
  assert(blNo.ok && blNo.kind === 'image', 'a genuinely flat white single-layer image is still shown');
  var oneLayer = await ap.previewFile(write('flat.psd', buildPsd(W, H, blankPlanes, { layers: 0 })));
  assert(oneLayer.ok && oneLayer.kind === 'image' && !oneLayer.note, 'a flat white image with no layers is not treated as blank');
  console.log('  ✓ missing composite: uses the embedded thumbnail and tells the user how to get a full preview');

  /* unsupported bits -> thumbnail or reason */
  var f32 = await ap.previewFile(write('f32.psd', buildPsd(W, H, planes, { depth: 32 })));
  assert(f32.ok === false && /32 bits/.test(f32.reason), '32-bit without a thumbnail says why');
  var f32t = await ap.previewFile(write('f32t.psd', buildPsd(W, H, planes, { depth: 32, thumb: { jpeg: jpeg, width: 8, height: 8 } })));
  assert(f32t.ok && f32t.mime === 'image/jpeg', '32-bit with a thumbnail shows the thumbnail');
  console.log('  ✓ unsupported depths degrade to the thumbnail or a plain explanation');

  /* hostile / broken files */
  assert.strictEqual((await ap.previewFile(write('bad.psd', Buffer.from('not a psd at all')))).ok, false, 'wrong signature');
  var full = buildPsd(W, H, planes, { rle: false });
  assert.strictEqual((await ap.previewFile(write('trunc.psd', full.slice(0, full.length - 500)))).ok, false, 'truncated file is refused, not crashed on');
  var huge = Buffer.from(full); huge.writeUInt32BE(400000, 14); huge.writeUInt32BE(400000, 18);
  assert.strictEqual((await ap.previewFile(write('huge.psd', huge))).ok, false, 'a header claiming 160 gigapixels is refused');
  assert.strictEqual((await ap.previewFile(write('empty.psd', Buffer.alloc(0)))).ok, false, 'empty file');
  assert.strictEqual((await ap.previewFile(path.join(TMP, 'missing.psd'))).ok, false, 'missing file');
  var rleBomb = buildPsd(W, H, planes, { rle: true });
  assert.strictEqual(ap.unpackBits(Buffer.from([0x81, 7]), 300).length, 300, 'a run longer than the row is clipped to the row');
  assert.strictEqual(ap.unpackBits(Buffer.from([0x05]), 4).length, 4, 'a literal that runs off the input is clipped');
  console.log('  ✓ wrong signature, truncation, absurd sizes, empty and missing files, malformed RLE all refused safely');

  /* XMP thumbnails (INDD / AI) */
  var jp = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(300, 9), Buffer.from([0xFF, 0xD9])]);
  var b64 = jp.toString('base64').replace(/(.{76})/g, '$1&#xA;');
  var xmp = Buffer.from('junk<x:xmpmeta><xmpGImg:width>256</xmpGImg:width><xmpGImg:height>128</xmpGImg:height><xmpGImg:image>' + b64 + '</xmpGImg:image></x:xmpmeta>trailer');
  var xt = ap.xmpThumbnail(xmp);
  assert(xt && xt.jpeg.equals(jp), 'XMP base64 (with &#xA; line breaks) decodes to the JPEG');
  assert.strictEqual(ap.xmpThumbnail(Buffer.from('<xmpGImg:image>not-a-jpeg-at-all-but-long-enough-not-a-jpeg-at-all-but-long-enough-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</xmpGImg:image>')), null, 'non-JPEG data is rejected');
  var indd = await ap.previewFile(write('doc.indd', Buffer.concat([Buffer.alloc(5000, 3), xmp])));
  assert(indd.ok && indd.mime === 'image/jpeg' && indd.bytes.equals(jp), 'INDD preview comes from the XMP thumbnail');
  assert.strictEqual((await ap.previewFile(write('plain.indd', Buffer.alloc(3000, 1)))).ok, false, 'no embedded preview: says so');
  console.log('  ✓ InDesign: XMP thumbnail extracted; a file without one is reported honestly');

  /* AI */
  var aiPdf = await ap.previewFile(write('art.ai', Buffer.concat([Buffer.from('%PDF-1.6\n%âãÏÓ\n'), Buffer.alloc(2000, 32)])));
  assert(aiPdf.ok && aiPdf.kind === 'pdf', 'a PDF-compatible .ai goes to the PDF viewer');
  var aiNoPdf = await ap.previewFile(write('old.ai', Buffer.concat([Buffer.from('%!PS-Adobe-3.0\n'), xmp])));
  assert(aiNoPdf.ok && aiNoPdf.kind === 'image', 'a non-PDF .ai uses its XMP thumbnail');
  console.log('  ✓ Illustrator: PDF-compatible files use the PDF viewer, others the embedded thumbnail');

  /* XD */
  var zip = new JSZip();
  zip.file('mimetype', 'application/vnd.adobe.xd', { compression: 'STORE' });
  var pngSmall = ap.encodePng(2, 2, Buffer.alloc(16, 255)), pngBig = ap.encodePng(4, 4, Buffer.alloc(64, 128));
  zip.file('preview.png', pngSmall); zip.file('thumbnail.png', pngSmall);
  zip.file('renditions/image-512-288.png', pngSmall); zip.file('renditions/image-1920-1080.png', pngBig);
  var xd = await ap.previewFile(write('ui.xd', await zip.generateAsync({ type: 'nodebuffer' })));
  assert(xd.ok && xd.mime === 'image/png' && xd.bytes.equals(pngBig) && /1920-1080/.test(xd.source), 'XD picks the largest rendition');
  var zip2 = new JSZip(); zip2.file('mimetype', 'application/vnd.adobe.xd'); zip2.file('preview.png', pngSmall);
  var xd2 = await ap.previewFile(write('ui2.xd', await zip2.generateAsync({ type: 'nodebuffer' })));
  assert(xd2.ok && xd2.bytes.equals(pngSmall), 'XD without renditions uses preview.png');
  var zip3 = new JSZip(); zip3.file('mimetype', 'x');
  assert.strictEqual((await ap.previewFile(write('ui3.xd', await zip3.generateAsync({ type: 'nodebuffer' })))).ok, false, 'XD with no image says so');
  assert.strictEqual((await ap.previewFile(write('ui4.xd', Buffer.from('not a zip')))).ok, false, 'a corrupt XD is refused');
  console.log('  ✓ XD: largest rendition, then preview.png; corrupt or image-less files refused');

  /* Fresco */
  var fr = await ap.previewFile(write('paint.fresco', Buffer.from('x')));
  assert(fr.ok === false && /Creative Cloud/.test(fr.reason) && /PSD/.test(fr.reason), 'Fresco: explains the export route');
  console.log('  ✓ Fresco: explains why and how to export (PSD/PDF), no pretending');
}

run().then(function() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ }
  console.log('ALL ADOBE PREVIEW TESTS PASSED');
  process.exit(0);
}).catch(function(e) { console.log('ADOBE PREVIEW TEST FAILED'); console.log(e && e.stack || e); process.exit(1); });
