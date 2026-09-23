/* gen-format-samples.js — builds REAL, spec-valid sample files for the
   formats added this session (HDR, EXR, Krita, OBJ+MTL) into
   tools/card-audit/media/formats/, for use by a CDP live-test script.
   Reuses the exact same real-file builders test/hdr-preview-test.js and
   test/paint-preview-test.js already use to verify the decoders — not
   degenerate/synthetic fixtures.

   Run: node tools/card-audit/gen-format-samples.js */
var fs = require('fs');
var path = require('path');
var JSZip = require('jszip');
var hdr = require('../../src/hdr-preview');
var adobePreview = require('../../src/adobe-preview');

var OUT = path.join(__dirname, 'media', 'formats');
fs.mkdirSync(OUT, { recursive: true });

/* ── HDR (real RLE-encoded Radiance file via the product's own exported test helper) ── */
function makeHdr() {
  var w = 64, h = 48;
  var data = new Float32Array(w * h * 3);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 3;
      data[i] = (x / w) * 4.0;
      data[i + 1] = (y / h) * 2.0;
      data[i + 2] = 0.35;
    }
  }
  var bytes = hdr.writeHdrForTest(w, h, data);
  fs.writeFileSync(path.join(OUT, 'sample.hdr'), Buffer.from(bytes));
}

/* ── EXR (real spec-built NONE-compression file, same builder as the test suite) ── */
function floatToHalfBits(v) {
  var f32 = new Float32Array([v]);
  var bits = new Uint32Array(f32.buffer)[0];
  var sign = (bits >>> 16) & 0x8000;
  var exp = ((bits >>> 23) & 0xff) - 127 + 15;
  var mant = bits & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >> 13);
}
function cstr(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]); }
function i32(v) { var b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; }
function u8(v) { return Buffer.from([v]); }
function f32(v) { var b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; }

function buildExrHeaderAttrs(width, height, compression) {
  var chlist = [];
  ['B', 'G', 'R'].forEach(function(name) {
    chlist.push(cstr(name), i32(1), u8(0), Buffer.alloc(3), i32(1), i32(1));
  });
  chlist.push(Buffer.from([0]));
  var channelsAttr = Buffer.concat(chlist);
  var dataWindow = Buffer.concat([i32(0), i32(0), i32(width - 1), i32(height - 1)]);
  function attr(name, type, valueBuf) {
    return Buffer.concat([cstr(name), cstr(type), i32(valueBuf.length), valueBuf]);
  }
  return Buffer.concat([
    attr('channels', 'chlist', channelsAttr),
    attr('compression', 'compression', u8(compression)),
    attr('dataWindow', 'box2i', dataWindow),
    attr('displayWindow', 'box2i', dataWindow),
    attr('lineOrder', 'lineOrder', u8(0)),
    attr('pixelAspectRatio', 'float', f32(1)),
    attr('screenWindowCenter', 'v2f', Buffer.concat([f32(0), f32(0)])),
    attr('screenWindowWidth', 'float', f32(1)),
    Buffer.from([0])
  ]);
}
function buildExrScanlineData(width, height, halfRGB) {
  var scanlines = [];
  for (var y = 0; y < height; y++) {
    var raw = Buffer.alloc(width * 2 * 3);
    for (var ch = 0; ch < 3; ch++) {
      for (var x = 0; x < width; x++) {
        var idx = (y * width + x) * 3 + (2 - ch);
        raw.writeUInt16LE(floatToHalfBits(halfRGB[idx]), (ch * width + x) * 2);
      }
    }
    scanlines.push(Buffer.concat([i32(y), i32(raw.length), raw]));
  }
  var offsetTableBuf = Buffer.alloc(height * 8);
  return Buffer.concat([offsetTableBuf].concat(scanlines));
}
function makeExr() {
  var w = 32, h = 24;
  var rgb = new Float32Array(w * h * 3);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 3;
      rgb[i] = x / w; rgb[i + 1] = y / h; rgb[i + 2] = 0.5;
    }
  }
  var magic = Buffer.from([0x76, 0x2f, 0x31, 0x01]);
  var version = Buffer.from([2, 0, 0, 0]);
  var header = buildExrHeaderAttrs(w, h, 0 /* NONE */);
  var data = buildExrScanlineData(w, h, rgb);
  fs.writeFileSync(path.join(OUT, 'sample.exr'), Buffer.concat([magic, version, header, data]));
}

/* ── OBJ + companion MTL (plain text, hand-written — trivial real format) ── */
function makeObjMtl() {
  var mtl = [
    'newmtl SampleMat',
    'Kd 0.8 0.2 0.2',
    'Ka 0.1 0.1 0.1',
    'Ks 0.5 0.5 0.5',
    'Ns 32.0',
    ''
  ].join('\n');
  var obj = [
    'mtllib sample.mtl',
    'o SampleCube',
    'v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1',
    'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
    'usemtl SampleMat',
    'f 1 2 3 4',
    'f 5 6 7 8',
    'f 1 2 6 5',
    'f 2 3 7 6',
    'f 3 4 8 7',
    'f 4 1 5 8',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'sample.mtl'), mtl);
  fs.writeFileSync(path.join(OUT, 'sample.obj'), obj);
}

/* ── Krita .kra (real zip via jszip, real PNG preview — same builder as the test suite) ── */
function solidPng(w, h, r, g, b) {
  var rgba = Buffer.alloc(w * h * 4);
  for (var i = 0; i < w * h; i++) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255; }
  return adobePreview.encodePng(w, h, rgba);
}
function makeKra() {
  var zip = new JSZip();
  zip.file('mimetype', 'application/x-krita');
  zip.file('maindoc.xml', '<DOC/>');
  zip.file('preview.png', solidPng(96, 64, 120, 60, 220));
  zip.file('layers/layer0.png', solidPng(256, 256, 0, 255, 0));
  return zip.generateAsync({ type: 'nodebuffer' }).then(function(buf) {
    fs.writeFileSync(path.join(OUT, 'sample.kra'), buf);
  });
}

/* ── Labeled-fallback formats: content is irrelevant (recognized by
   extension only, never decoded) — empty placeholder is correct. ── */
function makeFallbackPlaceholders() {
  ['sample.c4d', 'sample.hip', 'sample.ma', 'sample.clip', 'sample.procreate', 'sample.ztl'].forEach(function(name) {
    fs.writeFileSync(path.join(OUT, name), Buffer.from('placeholder, never decoded\n'));
  });
}

makeHdr();
makeExr();
makeObjMtl();
makeFallbackPlaceholders();
makeKra().then(function() {
  console.log('Sample files written to ' + OUT);
  fs.readdirSync(OUT).forEach(function(f) { console.log('  ' + f); });
});
