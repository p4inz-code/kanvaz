/* paint-preview-test.js — src/paint-preview.js (Krita .kra preview).

   Builds a real, valid .kra-shaped ZIP in memory (via the same jszip
   dependency the reader uses to read one) with a canonical preview.png,
   a decoy same-format image at a higher "score" location, and a
   layers/ thumbnail that must be excluded — then reads it back through
   the real reader.

   Run: node test/paint-preview-test.js */
var assert = require('assert');
var os = require('os');
var path = require('path');
var fs = require('fs');
var JSZip = require('jszip');
var adobePreview = require('../src/adobe-preview');   /* reuse its already-tested encodePng */
var paint = require('../src/paint-preview');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-kra-'));

function solidPng(w, h, r, g, b) {
  var rgba = Buffer.alloc(w * h * 4);
  for (var i = 0; i < w * h; i++) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255; }
  return adobePreview.encodePng(w, h, rgba);
}

async function writeKra(fileName, entries) {
  var zip = new JSZip();
  Object.keys(entries).forEach(function(name) { zip.file(name, entries[name]); });
  var buf = await zip.generateAsync({ type: 'nodebuffer' });
  var p = path.join(TMP, fileName);
  fs.writeFileSync(p, buf);
  return p;
}

async function testFindsCanonicalPreview() {
  var canonical = solidPng(64, 48, 255, 0, 0);       /* the real whole-canvas composite: bright red */
  var layerThumb = solidPng(200, 200, 0, 255, 0);    /* bigger by raw size, but must be excluded (layers/) */
  var decoy = solidPng(8, 8, 0, 0, 255);             /* small, non-canonical name, must lose to preview.png */
  var p = await writeKra('real.kra', {
    'mimetype': 'application/x-krita',
    'maindoc.xml': '<DOC/>',
    'preview.png': canonical,
    'layers/layer0.png': layerThumb,
    'thumbnail.png': decoy
  });
  var res = await paint.previewFile(p);
  assert(res.ok, 'a real Krita-shaped file previews: ' + (res.reason || ''));
  assert.strictEqual(res.source, 'preview.png', 'the canonical preview.png is chosen, not the bigger layer thumbnail or the small decoy');
  assert.strictEqual(res.mime, 'image/png');
  assert(res.bytes.length > 0);
  console.log('  ✓ Krita (.kra): finds and returns the real preview.png, not a per-layer thumbnail or a smaller decoy');
}

async function testMergedImageFallback() {
  var canonical = solidPng(32, 32, 10, 20, 30);
  var p = await writeKra('merged.kra', {
    'mimetype': 'application/x-krita',
    'mergedimage.png': canonical
  });
  var res = await paint.previewFile(p);
  assert(res.ok);
  assert.strictEqual(res.source, 'mergedimage.png', 'mergedimage.png (the other real Krita composite name) is also recognised');
  console.log('  ✓ Krita: mergedimage.png (the alternate real-composite name) is also found');
}

async function testNoPreviewAvailable() {
  var p = await writeKra('empty.kra', {
    'mimetype': 'application/x-krita',
    'maindoc.xml': '<DOC/>'
  });
  var res = await paint.previewFile(p);
  assert.strictEqual(res.ok, false, 'a .kra with no whole-canvas image gives an honest reason, not a crash or a wrong picture');
  assert(/no whole-canvas preview/.test(res.reason));
  console.log('  ✓ Krita: a file with no whole-canvas preview image fails with an honest reason, not a fake one');
}

async function testRejectsGarbage() {
  var p = path.join(TMP, 'notreally.kra');
  fs.writeFileSync(p, 'this is not a zip file at all');
  var res = await paint.previewFile(p);
  assert.strictEqual(res.ok, false);
  console.log('  ✓ Krita: a non-ZIP file with a .kra extension fails loudly instead of crashing');
}

async function testWrongExtensionRefused() {
  var res = await paint.previewFile(path.join(TMP, 'whatever.psd'));
  assert.strictEqual(res.ok, false);
  console.log('  ✓ a non-.kra path is refused outright (this reader only handles Krita)');
}

async function run() {
  await testFindsCanonicalPreview();
  await testMergedImageFallback();
  await testNoPreviewAvailable();
  await testRejectsGarbage();
  await testWrongExtensionRefused();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ }
  console.log('ALL PAINT PREVIEW TESTS PASSED');
}

run().catch(function(e) {
  console.log('PAINT PREVIEW TEST FAILED');
  console.log(e && e.stack || e);
  process.exit(1);
});
