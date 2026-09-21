/* adobe-preview.js — in-card previews for Adobe files, without Adobe software.

   What each format really contains (checked against Adobe's own documentation
   and the published PSD layout, not assumed):
     .psd / .psb  a full-resolution flattened "composite" after the layers,
                  raw or RLE (PackBits). Present when the file was saved with
                  "Maximize Compatibility" (Photoshop's default). Without it
                  the composite is a blank placeholder; the small JPEG
                  thumbnail in the image resources is then all that is left.
     .ai          PDF-compatible unless saved otherwise: the renderer draws it
                  with the PDF viewer Kanvaz already has. Otherwise an XMP
                  thumbnail, if present.
     .xd          a ZIP holding preview.png / thumbnail.png and renditions/.
     .indd/.indt  an XMP thumbnail (base64 JPEG) inside the file.
     .fresco      Fresco keeps its native files in Creative Cloud and cannot
                  save them locally; Adobe's route out is export as PSD, PNG or
                  PDF, which is what previews here.

   PSD reading is STREAMING and DOWNSCALING: the file is never loaded whole
   (a PSD can be a gigabyte) and rows are averaged into the preview size while
   they are decoded, so memory stays at preview size, not source size.

   Colour honesty: 8 and 16-bit RGB, grayscale and indexed are exact. CMYK uses
   the plain device conversion (no ICC profile), so it is close, not identical
   to Photoshop's soft-proofed view. 32-bit, bitmap and Lab fall back to the
   embedded thumbnail. Node-only, ES5/var-only like the rest of src/. */

'use strict';

var fs = require('fs');
var zlib = require('zlib');
var JSZip = require('jszip');

var DEFAULT_MAX_SIDE = 3072;
var MAX_PIXELS = 1000000000;      /* refuse absurd headers (1 gigapixel) */
var XMP_SCAN_BYTES = 32 * 1024 * 1024;

/* ── low-level readers ─────────────────────────────────────── */

/* Sequential reader over a file descriptor with a chunk cache, plus seeking. */
function FileSeq(fd, size) {
  this.fd = fd; this.size = size; this.pos = 0;
  this.buf = Buffer.alloc(1 << 20); this.bufStart = 0; this.bufLen = 0;
}
FileSeq.prototype.seek = function(p) { this.pos = p; };
FileSeq.prototype.read = function(n) {
  if (n < 0 || this.pos + n > this.size) throw new Error('unexpected end of file');
  var out = Buffer.alloc(n);
  var got = 0;
  while (got < n) {
    var p = this.pos + got;
    if (p < this.bufStart || p >= this.bufStart + this.bufLen) {
      this.bufStart = p;
      this.bufLen = fs.readSync(this.fd, this.buf, 0, this.buf.length, p);
      if (this.bufLen <= 0) throw new Error('unexpected end of file');
    }
    var take = Math.min(n - got, this.bufStart + this.bufLen - p);
    this.buf.copy(out, got, p - this.bufStart, p - this.bufStart + take);
    got += take;
  }
  this.pos += n;
  return out;
};
FileSeq.prototype.u8 = function() { return this.read(1)[0]; };
FileSeq.prototype.u16 = function() { return this.read(2).readUInt16BE(0); };
FileSeq.prototype.i16 = function() { return this.read(2).readInt16BE(0); };
FileSeq.prototype.u32 = function() { return this.read(4).readUInt32BE(0); };
FileSeq.prototype.u64 = function() { var b = this.read(8); return b.readUInt32BE(0) * 4294967296 + b.readUInt32BE(4); };

/* PackBits: one scanline. Returns a Buffer of exactly `want` bytes. */
function unpackBits(src, want) {
  var out = Buffer.alloc(want);
  var i = 0, o = 0;
  while (i < src.length && o < want) {
    var n = src[i++];
    if (n > 127) n -= 256;
    if (n >= 0) {
      var c = n + 1;
      if (i + c > src.length) c = src.length - i;
      if (o + c > want) c = want - o;
      src.copy(out, o, i, i + c);
      i += n + 1; o += c;
    } else if (n !== -128) {
      var run = 1 - n;
      var v = src[i++];
      if (o + run > want) run = want - o;
      out.fill(v, o, o + run);
      o += run;
    }
  }
  return out;
}

/* ── PNG writer (RGB or RGBA 8-bit) ────────────────────────── */

var CRC_TABLE = (function() {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  var head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.slice(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/* rgba: Buffer of width*height*4. Writes RGB (colour type 2) when every pixel
   is opaque, RGBA (6) otherwise, with the Sub filter for better compression. */
function encodePng(width, height, rgba) {
  var opaque = true;
  for (var i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  var bpp = opaque ? 3 : 4;
  var stride = width * bpp;
  var raw = Buffer.alloc((stride + 1) * height);
  for (var y = 0; y < height; y++) {
    var ro = y * (stride + 1);
    raw[ro] = 1;   /* filter: Sub */
    var prev = [0, 0, 0, 0];
    for (var x = 0; x < width; x++) {
      var si = (y * width + x) * 4;
      for (var c = 0; c < bpp; c++) {
        var v = rgba[si + c];
        raw[ro + 1 + x * bpp + c] = (v - prev[c]) & 255;
        prev[c] = v;
      }
    }
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 5 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ── PSD / PSB ─────────────────────────────────────────────── */

/* Returns { ok:true, kind:'composite', width, height, srcWidth, srcHeight,
   hasAlpha, blank, rgba, thumbnail } or { ok:true, kind:'thumbnail', ... }
   or { ok:false, reason }. */
function readPsd(filePath, opts) {
  opts = opts || {};
  var maxSide = opts.maxSide || DEFAULT_MAX_SIDE;
  var fd = null;
  try {
    var st = fs.statSync(filePath);
    if (!st.isFile()) return { ok: false, reason: 'not a regular file' };
    fd = fs.openSync(filePath, 'r');
    var f = new FileSeq(fd, st.size);

    if (f.read(4).toString('latin1') !== '8BPS') return { ok: false, reason: 'not a Photoshop file' };
    var version = f.u16();
    if (version !== 1 && version !== 2) return { ok: false, reason: 'unknown PSD version ' + version };
    var big = version === 2;
    f.read(6);
    var channels = f.u16(), height = f.u32(), width = f.u32(), depth = f.u16(), mode = f.u16();
    /* Limits from the format itself: a PSD is at most 30,000 x 30,000 px, a PSB
       300,000, and a file has at most 56 channels. Checked BEFORE anything is
       sized from these numbers (a 46-byte file used to be able to ask for gigabytes). */
    var sideMax = big ? 300000 : 30000;
    if (!width || !height || width > sideMax || height > sideMax || width * height > MAX_PIXELS) return { ok: false, reason: 'unreasonable image size' };
    if (channels < 1 || channels > 56) return { ok: false, reason: 'unreasonable channel count' };

    var modeLen = f.u32();
    var palette = modeLen ? f.read(modeLen) : null;

    /* image resources: keep the embedded JPEG thumbnail as a fallback */
    var resEnd = f.u32();
    resEnd += f.pos;
    var thumb = null;
    while (f.pos + 12 <= resEnd) {
      if (f.read(4).toString('latin1') !== '8BIM') break;
      var rid = f.u16();
      var nameLen = f.u8();
      f.read((nameLen + 1) % 2 === 0 ? nameLen : nameLen + 1);
      var rsize = f.u32();
      var rpad = rsize + (rsize % 2);
      if (rid === 1036 && rsize > 28 && rsize < 8 * 1024 * 1024) {
        var rd = f.read(rpad);
        var tw = rd.readUInt32BE(4), th = rd.readUInt32BE(8), csize = rd.readUInt32BE(20);
        if (rd.readUInt32BE(0) === 1 && csize > 0 && 28 + csize <= rd.length) thumb = { jpeg: rd.slice(28, 28 + csize), width: tw, height: th };
      } else {
        f.seek(f.pos + rpad);
      }
    }
    f.seek(resEnd);

    /* layer and mask information: skip it, but note the layer count. A
       negative count means the first extra channel of the composite is the
       transparency of the merged result. */
    var lmLen = big ? f.u64() : f.u32();
    var lmStart = f.pos;
    var layerCount = 0, mergedAlpha = false;
    if (lmLen > 0) {
      var liLen = big ? f.u64() : f.u32();
      if (liLen > 0) { var lc = f.i16(); mergedAlpha = lc < 0; layerCount = Math.abs(lc); }
    }
    f.seek(lmStart + lmLen);

    var fallback = function(reason) {
      if (thumb) return { ok: true, kind: 'thumbnail', jpeg: thumb.jpeg, width: thumb.width, height: thumb.height, reason: reason };
      return { ok: false, reason: reason };
    };

    if (depth !== 8 && depth !== 16) return fallback('This file uses ' + depth + ' bits per channel, which the preview cannot decode.');
    var colorChannels = mode === 3 ? 3 : mode === 1 || mode === 2 ? 1 : mode === 4 ? 4 : 0;
    if (!colorChannels) return fallback('This colour mode (' + mode + ') is not supported for preview.');
    var wantAlpha = mergedAlpha && channels > colorChannels;
    var keep = colorChannels + (wantAlpha ? 1 : 0);
    if (channels < colorChannels) return fallback('The file has fewer channels than its colour mode needs.');

    var compression = f.u16();
    if (compression !== 0 && compression !== 1) return fallback('The flattened image uses compression ' + compression + ', which the preview cannot decode.');

    if (compression === 0 && st.size - f.pos < keep * height * width * (depth / 8)) return fallback('The file is shorter than its header says (damaged or cut off).');
    var scale = Math.min(1, maxSide / Math.max(width, height));
    var sw = Math.max(1, Math.round(width * scale)), sh = Math.max(1, Math.round(height * scale));
    var bps = depth / 8;
    var rowBytes = width * bps;
    var nearest = mode === 2;   /* indexed: averaging indices would invent colours */

    /* how many source columns / rows fall into each output cell */
    var nx = new Uint32Array(sw), ny = new Uint32Array(sh), mapX = new Uint32Array(width);
    for (var x = 0; x < width; x++) { var dx = Math.min(sw - 1, Math.floor(x * sw / width)); mapX[x] = dx; nx[dx]++; }
    for (var y0 = 0; y0 < height; y0++) ny[Math.min(sh - 1, Math.floor(y0 * sh / height))]++;

    /* RLE: per-row compressed sizes for every channel come first */
    var counts = null;
    if (compression === 1) {
      var tbl = f.read((big ? 4 : 2) * height * channels);
      counts = new Uint32Array(height * channels);
      for (var ci = 0; ci < counts.length; ci++) counts[ci] = big ? tbl.readUInt32BE(ci * 4) : tbl.readUInt16BE(ci * 2);
    }

    var acc = [];
    for (var k = 0; k < keep; k++) acc.push(new Uint32Array(sw * sh));
    for (var ch = 0; ch < channels; ch++) {
      var needed = ch < keep;
      for (var y = 0; y < height; y++) {
        var row;
        if (compression === 1) {
          var clen = counts[ch * height + y];
          if (!needed) { f.seek(f.pos + clen); continue; }
          row = unpackBits(f.read(clen), rowBytes);
        } else {
          if (!needed) { f.seek(f.pos + rowBytes); continue; }
          row = f.read(rowBytes);
        }
        var dy = Math.min(sh - 1, Math.floor(y * sh / height));
        var a = acc[ch], base = dy * sw;
        if (nearest) {
          /* first source row of the cell, first column of each cell */
          if (y === 0 || Math.floor((y - 1) * sh / height) !== dy) {
            for (var xn = 0; xn < width; xn++) if (xn === 0 || mapX[xn - 1] !== mapX[xn]) a[base + mapX[xn]] = row[xn * bps];
          }
        } else if (depth === 8) {
          for (var xa = 0; xa < width; xa++) a[base + mapX[xa]] += row[xa];
        } else {
          for (var xb = 0; xb < width; xb++) a[base + mapX[xb]] += (row[xb * 2] << 8) | row[xb * 2 + 1];
        }
      }
    }

    /* average, then convert to RGBA */
    var out = Buffer.alloc(sw * sh * 4);
    var div = depth === 16 ? 257 : 1;
    var minV = 255, maxV = 0, hasAlpha = false, colourful = false;
    function chan(c, idx, cell) {
      if (nearest) return acc[c][idx];
      return acc[c][idx] / (nx[cell % sw] * ny[Math.floor(cell / sw)]) / div;
    }
    for (var p = 0; p < sw * sh; p++) {
      var r, g, b, al = 255;
      if (mode === 3) { r = chan(0, p, p); g = chan(1, p, p); b = chan(2, p, p); }
      else if (mode === 1) { r = g = b = chan(0, p, p); }
      else if (mode === 2) {
        var pi = chan(0, p, p);
        r = palette ? palette[pi] : pi; g = palette ? palette[256 + pi] : pi; b = palette ? palette[512 + pi] : pi;
      } else {
        /* Photoshop stores CMYK inverted (255 = no ink) */
        var c0 = chan(0, p, p), m0 = chan(1, p, p), y1 = chan(2, p, p), k0 = chan(3, p, p);
        r = c0 * k0 / 255; g = m0 * k0 / 255; b = y1 * k0 / 255;
      }
      if (wantAlpha) { al = chan(colorChannels, p, p); if (al < 255) hasAlpha = true; }
      var o = p * 4;
      r = Math.round(r); g = Math.round(g); b = Math.round(b); al = Math.round(al);
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = al;
      /* "blank" means every colour channel is flat, not just red */
      var lo = r < g ? (r < b ? r : b) : (g < b ? g : b), hi = r > g ? (r > b ? r : b) : (g > b ? g : b);
      if (lo < minV) minV = lo;
      if (hi > maxV) maxV = hi;
      if (r !== g || g !== b) colourful = true;
    }
    /* A layered file saved without Maximize Compatibility has a blank
       composite: one flat colour. Fall back to the thumbnail and say why. */
    var blank = layerCount > 0 && (maxV - minV) < 1 && !colourful;
    if (blank && thumb) return fallback('This file was saved without "Maximize Compatibility", so it has no flattened image. Showing its small embedded thumbnail; re-save with Maximize Compatibility on for a full preview.');
    return {
      ok: true, kind: 'composite', width: sw, height: sh, srcWidth: width, srcHeight: height,
      hasAlpha: hasAlpha, blank: blank, layers: layerCount, depth: depth, mode: mode, rgba: out
    };
  } catch (e) {
    return { ok: false, reason: 'could not read this file: ' + e.message };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e2) { /* closed */ } }
  }
}

/* ── XMP thumbnail (INDD, AI without PDF data, and others) ── */

/* Adobe writes a base64 JPEG preview in the XMP packet:
   <xmpGImg:image>/9j/4AAQ...</xmpGImg:image>, with &#xA; line breaks. */
function xmpThumbnail(buf) {
  var text = buf.toString('latin1');
  var a = text.indexOf('<xmpGImg:image>');
  if (a === -1) return null;
  var b = text.indexOf('</xmpGImg:image>', a);
  if (b === -1) return null;
  var b64 = text.slice(a + 15, b).replace(/&#x?[0-9a-fA-F]+;/g, '').replace(/\s+/g, '');
  var jpeg;
  try { jpeg = Buffer.from(b64, 'base64'); } catch (e) { return null; }
  if (jpeg.length < 100 || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return null;
  var w = null, h = null;
  var near = text.slice(Math.max(0, a - 600), b + 200);
  var wm = /<xmpGImg:width>(\d+)</.exec(near), hm = /<xmpGImg:height>(\d+)</.exec(near);
  if (wm) w = parseInt(wm[1], 10); if (hm) h = parseInt(hm[1], 10);
  return { jpeg: jpeg, width: w, height: h };
}

function readHead(filePath, n) {
  var fd = fs.openSync(filePath, 'r');
  try {
    var st = fs.fstatSync(fd);
    var buf = Buffer.alloc(Math.min(n, st.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf;
  } finally { fs.closeSync(fd); }
}

/* ── XD ────────────────────────────────────────────────────── */

var XD_MAX_FILE = 300 * 1024 * 1024;      /* the whole archive is read into memory */
var XD_MAX_ENTRY = 60 * 1024 * 1024;      /* one preview image, uncompressed */
var XD_MAX_ENTRIES = 5000;
async function readXd(filePath, maxBytes) {
  var st = fs.statSync(filePath);
  if (st.size > (maxBytes || XD_MAX_FILE)) return { ok: false, reason: 'file too large to preview' };
  var zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  var best = null, bestArea = -1;
  var names = Object.keys(zip.files);
  if (names.length > XD_MAX_ENTRIES) return { ok: false, reason: 'this XD file has too many entries' };
  for (var ni = 0; ni < names.length; ni++) {
    var name = names[ni], entry = zip.files[name];
    /* very long names are never real renditions, and would make the pattern below slow */
    if (entry.dir || name.length > 200 || !/\.(png|jpe?g)$/i.test(name)) continue;
    /* skip anything that would inflate past the limit: the size is read from the
       archive's own directory, before a single byte is inflated */
    var declared = entry._data && entry._data.uncompressedSize;
    if (typeof declared !== 'number' || declared > XD_MAX_ENTRY) continue;
    var area = -1;
    var m = /(\d+)-(\d+)\.(png|jpe?g)$/i.exec(name);
    if (/^renditions\//i.test(name) && m) area = parseInt(m[1], 10) * parseInt(m[2], 10);
    else if (/preview\.png$/i.test(name)) area = 1;
    else if (/thumbnail\.png$/i.test(name)) area = 0;
    if (area > bestArea) { best = { name: name, entry: entry }; bestArea = area; }
  }
  if (!best) return { ok: false, reason: 'this XD file has no preview image' };
  var data = await best.entry.async('nodebuffer');
  var isJpeg = data[0] === 0xFF;
  return { ok: true, kind: 'image', mime: isJpeg ? 'image/jpeg' : 'image/png', bytes: data, source: best.name };
}

/* ── one entry point ───────────────────────────────────────── */

var FRESCO_MSG = 'Adobe Fresco keeps its own files in Creative Cloud and cannot save them on this computer. In Fresco choose Share, then Publish & Export, and export PSD or PDF; that file previews here.';

/* Returns one of:
     { ok:true, kind:'image', mime, bytes, width, height, note? }   a picture to show
     { ok:true, kind:'pdf' }                                        the renderer's PDF viewer should draw it
     { ok:false, reason }                                            say why, keep the icon */
async function previewFile(filePath, opts) {
  opts = opts || {};
  var ext = String(filePath).toLowerCase().replace(/^.*\./, '');
  try {
    if (ext === 'fresco') return { ok: false, reason: FRESCO_MSG };
    /* A named pipe or device with an Adobe extension would block a read forever. */
    if (!fs.statSync(filePath).isFile()) return { ok: false, reason: 'not a regular file' };

    if (ext === 'psd' || ext === 'psb') {
      var r = readPsd(filePath, opts);
      if (!r.ok) return r;
      if (r.kind === 'thumbnail') return { ok: true, kind: 'image', mime: 'image/jpeg', bytes: r.jpeg, width: r.width, height: r.height, note: r.reason };
      return { ok: true, kind: 'image', mime: 'image/png', bytes: encodePng(r.width, r.height, r.rgba), width: r.width, height: r.height,
        srcWidth: r.srcWidth, srcHeight: r.srcHeight, layers: r.layers, note: r.mode === 4 ? 'CMYK shown with a plain device conversion (no colour profile), so colours are close, not exact.' : null };
    }

    if (ext === 'xd') {
      var x = await readXd(filePath);
      return x;
    }

    if (ext === 'ai') {
      var head = readHead(filePath, 1024);
      if (head.toString('latin1').indexOf('%PDF') !== -1) return { ok: true, kind: 'pdf' };
    }

    if (ext === 'ai' || ext === 'indd' || ext === 'indt' || ext === 'idml') {
      var st = fs.statSync(filePath);
      var fd = fs.openSync(filePath, 'r');
      var buf;
      try {
        buf = Buffer.alloc(Math.min(st.size, XMP_SCAN_BYTES));
        fs.readSync(fd, buf, 0, buf.length, 0);
      } finally { fs.closeSync(fd); }
      var t = xmpThumbnail(buf);
      if (t) return { ok: true, kind: 'image', mime: 'image/jpeg', bytes: t.jpeg, width: t.width, height: t.height,
        note: 'Showing the small preview stored inside the file.' };
      return { ok: false, reason: 'This file has no embedded preview. Export it as PDF or PNG for a preview here.' };
    }
    return { ok: false, reason: 'not an Adobe file type this preview handles' };
  } catch (e) {
    return { ok: false, reason: 'could not preview this file: ' + e.message };
  }
}

var EXTENSIONS = ['psd', 'psb', 'ai', 'xd', 'indd', 'indt', 'fresco'];

module.exports = {
  EXTENSIONS: EXTENSIONS,
  readPsd: readPsd,
  xmpThumbnail: xmpThumbnail,
  encodePng: encodePng,
  unpackBits: unpackBits,
  previewFile: previewFile,
  FRESCO_MSG: FRESCO_MSG
};
