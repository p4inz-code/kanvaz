/* paint-preview.js — in-card previews for digital-painting file formats
   that aren't Adobe's (see adobe-preview.js for PSD/PSB/AI/XD/INDD) or an
   HDR image (see hdr-preview.js). Node-only (main process), same shape as
   both of those: read the real file, find/decode a preview image, hand
   back PNG/JPEG bytes.

   Krita (.kra): a real, documented ZIP container (same family as XD's own
   ZIP-based .xdesign format, and the same jszip dependency already used
   for that) — Krita itself writes a full-canvas PNG preview into the
   archive on every save, named "preview.png" or "mergedimage.png"
   depending on version, sometimes both. Picking the largest declared
   PNG/JPEG at any path (skipping the "layers/" folder's per-layer
   thumbnails, which are never the whole-canvas composite) is the same
   robust-to-naming-variation approach adobe-preview.js's XD reader
   already uses, for the same reason: don't hardcode one exact path and
   silently show nothing the day a version changes it. */

'use strict';

var fs = require('fs');
var JSZip = require('jszip');

var EXTENSIONS = ['kra'];
var KRA_MAX_FILE = 300 * 1024 * 1024;
var KRA_MAX_ENTRY = 60 * 1024 * 1024;
var KRA_MAX_ENTRIES = 20000;   /* a layered .kra can have many per-layer thumbnails; still bounded */

async function readKra(filePath, maxBytes) {
  var st = fs.statSync(filePath);
  if (!st.isFile()) return { ok: false, reason: 'not a regular file' };
  if (st.size > (maxBytes || KRA_MAX_FILE)) return { ok: false, reason: 'file too large to preview' };
  var zip;
  try {
    zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  } catch (e) {
    return { ok: false, reason: 'not a valid Krita file: ' + e.message };
  }
  var names = Object.keys(zip.files);
  if (names.length > KRA_MAX_ENTRIES) return { ok: false, reason: 'this file has too many entries' };

  var best = null, bestScore = -1;
  for (var i = 0; i < names.length; i++) {
    var name = names[i], entry = zip.files[name];
    if (entry.dir || name.length > 200 || !/\.(png|jpe?g)$/i.test(name)) continue;
    if (/^layers\//i.test(name) || /^preview\/tiles\//i.test(name)) continue;   /* per-layer/per-tile thumbnails, not the whole canvas */
    var declared = entry._data && entry._data.uncompressedSize;
    if (typeof declared !== 'number' || declared > KRA_MAX_ENTRY) continue;
    /* Real Krita saves use exactly "preview.png" / "mergedimage.png" at the
       archive root; scored above anything else so a stray same-named file
       nested deeper (or a version's own extra thumbnail) never wins over
       the real one. Ties broken by declared (uncompressed) size, the same
       "biggest is the real composite" heuristic XD's reader uses. */
    var isCanonical = /^(preview|mergedimage)\.png$/i.test(name);
    var score = (isCanonical ? 1e9 : 0) + declared;
    if (score > bestScore) { best = { name: name, entry: entry }; bestScore = score; }
  }
  if (!best) return { ok: false, reason: 'this Krita file has no whole-canvas preview image' };
  var data = await best.entry.async('nodebuffer');
  var isJpeg = data[0] === 0xff;
  return { ok: true, kind: 'image', mime: isJpeg ? 'image/jpeg' : 'image/png', bytes: data, source: best.name };
}

async function previewFile(filePath, opts) {
  try {
    var ext = (filePath.split('.').pop() || '').toLowerCase();
    if (ext !== 'kra') return { ok: false, reason: 'not a format this reader previews' };
    var r = await readKra(filePath, opts && opts.maxFileBytes);
    if (!r.ok) return r;
    return { ok: true, kind: 'image', mime: r.mime, bytes: r.bytes, source: r.source };
  } catch (e) {
    return { ok: false, reason: 'could not read this file: ' + e.message };
  }
}

module.exports = {
  EXTENSIONS: EXTENSIONS,
  readKra: readKra,
  previewFile: previewFile
};
