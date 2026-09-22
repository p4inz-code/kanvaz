/* hdr-preview.js — in-card previews for HDR/EXR files, without any DCC
   software. Node-only (main process), same shape as adobe-preview.js:
   read the real file, decode to raw pixels, tone-map down to a normal
   displayable image, hand back PNG bytes via adobe-preview.js's own
   encodePng() (one PNG encoder for the whole app, not two).

   Radiance HDR (.hdr/.pic): the RGBE format, "new" RLE scanlines or flat.
   Decode algorithm ported from three.js's own HDRLoader (r186) — same
   header parser, same run-length decoder, same RGBE->float formula
   (scale = 2^(E-128)/255) — so this reads exactly what the renderer's own
   3D-card HDR handling would, just run here instead of in a <canvas>.

   OpenEXR (.exr): header + scanline parsing is this module's own (OpenEXR's
   public spec is exact about layout), but only the NONE and RLE pixel-data
   compression methods are decoded. ZIP/ZIPS, PIZ, PXR24, B44/B44A and
   DWAA/DWAB are NOT implemented — PIZ in particular is a wavelet+Huffman
   scheme on the order of a thousand lines in three.js's own EXRLoader, and
   getting it subtly wrong would silently corrupt colours rather than fail
   loudly. An EXR using one of those is refused with a plain, honest reason
   instead of guessing. NONE and RLE still cover a real share of EXRs
   (uncompressed renders, and RLE is a common "just make it smaller,
   losslessly" choice) — this is a disclosed limitation, same class as
   "External textures next to an FBX are not loaded" already is.

   Both paths carry real dynamic range (values that can be far above 1.0 or
   near 0) — a linear cast to 0-255 the way an SDR image would go would
   render almost solid black or blown-out white for a typical HDRI. Tone-
   mapping here is one deliberately simple pass: scale by an automatic
   exposure (so the image's own average luminance lands near 18% grey, the
   same "middle grey" convention photographic metering uses) and a Reinhard
   operator (L/(1+L)) before the usual 2.2 gamma. This is a reference
   thumbnail, not a colour-managed viewer — good enough to recognise the
   image and judge it as a reference, not a promise of exposure-matched
   accuracy. */

'use strict';

var fs = require('fs');
var adobePreview = require('./adobe-preview');

var EXTENSIONS = ['hdr', 'pic', 'exr'];
var MAX_PIXELS = 64 * 1024 * 1024;    /* 64MP raw-pixel ceiling before decode, same spirit as adobe-preview's own cap */
var MAX_SIDE_DEFAULT = 2048;          /* downscale target — a reference thumbnail never needs full HDRI resolution */

/* ── shared: simple box-downscale + tone-map + gamma, float RGB in, RGBA8 out ── */

function luminance(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

/* Auto-exposure: average log-luminance (Reinhard '02's "key" estimate),
   scaled so it lands at 18% grey, then a straight Reinhard global operator.
   Sampled, not exhaustive, for speed on a large HDRI — a preview thumbnail
   does not need every pixel weighed. */
function toneMapToRgba8(width, height, floatRGB) {
  var n = width * height;
  var step = Math.max(1, Math.floor(n / 200000));   /* sample at most ~200k pixels for the exposure estimate */
  var sumLogL = 0, sampled = 0;
  for (var i = 0; i < n; i += step) {
    var o = i * 3;
    var l = luminance(floatRGB[o], floatRGB[o + 1], floatRGB[o + 2]);
    sumLogL += Math.log(1e-4 + l);
    sampled++;
  }
  var avgL = Math.exp(sumLogL / Math.max(1, sampled));
  var exposure = avgL > 1e-6 ? (0.18 / avgL) : 1;

  var rgba = Buffer.alloc(n * 4);
  var invGamma = 1 / 2.2;
  for (var p = 0; p < n; p++) {
    var src = p * 3;
    var r = floatRGB[src] * exposure, g = floatRGB[src + 1] * exposure, b = floatRGB[src + 2] * exposure;
    r = r / (1 + r); g = g / (1 + g); b = b / (1 + b);   /* Reinhard */
    r = Math.pow(Math.max(0, r), invGamma); g = Math.pow(Math.max(0, g), invGamma); b = Math.pow(Math.max(0, b), invGamma);
    var dst = p * 4;
    rgba[dst] = Math.round(Math.min(1, r) * 255);
    rgba[dst + 1] = Math.round(Math.min(1, g) * 255);
    rgba[dst + 2] = Math.round(Math.min(1, b) * 255);
    rgba[dst + 3] = 255;
  }
  return rgba;
}

/* Box-filter downscale of an interleaved float RGB buffer — run BEFORE
   tone-mapping (averaging linear light, not gamma-corrected output, is
   the physically correct order and cheaper: fewer pixels reach the
   per-pixel tone-map loop above). */
function downscaleFloatRGB(width, height, floatRGB, maxSide) {
  if (width <= maxSide && height <= maxSide) return { width: width, height: height, data: floatRGB };
  var scale = maxSide / Math.max(width, height);
  var outW = Math.max(1, Math.round(width * scale));
  var outH = Math.max(1, Math.round(height * scale));
  var out = new Float32Array(outW * outH * 3);
  for (var oy = 0; oy < outH; oy++) {
    var sy0 = Math.floor(oy / scale), sy1 = Math.max(sy0 + 1, Math.floor((oy + 1) / scale));
    sy1 = Math.min(sy1, height);
    for (var ox = 0; ox < outW; ox++) {
      var sx0 = Math.floor(ox / scale), sx1 = Math.max(sx0 + 1, Math.floor((ox + 1) / scale));
      sx1 = Math.min(sx1, width);
      var r = 0, g = 0, b = 0, count = 0;
      for (var sy = sy0; sy < sy1; sy++) {
        var rowBase = sy * width;
        for (var sx = sx0; sx < sx1; sx++) {
          var o = (rowBase + sx) * 3;
          r += floatRGB[o]; g += floatRGB[o + 1]; b += floatRGB[o + 2];
          count++;
        }
      }
      var dst = (oy * outW + ox) * 3;
      count = count || 1;
      out[dst] = r / count; out[dst + 1] = g / count; out[dst + 2] = b / count;
    }
  }
  return { width: outW, height: outH, data: out };
}

/* ── Radiance HDR / RGBE ──
   Ported from three.js's HDRLoader (r186) — same header regexes, same
   "new-style RLE" detection (first 4 bytes of a scanline are
   2,2,hi(width),lo(width) with width in [8,0x7fff]), same per-channel
   run-length decode, same RGBE->linear-float formula. See that loader's
   own comments (adapted from graphics.cornell.edu/~bjw/rgbe.html) for the
   format's history — this is a faithful, from-scratch Node port, not a
   copy of its (browser-oriented, TypedArray-of-an-ArrayBuffer) code. */
function readHdr(buf) {
  var pos = 0;

  function readLine() {
    var start = pos;
    while (pos < buf.length && buf[pos] !== 0x0a) pos++;
    var line = buf.toString('latin1', start, pos);
    pos++;   /* past the \n */
    return line;
  }

  var magic = readLine();
  if (!/^#\?/.test(magic)) throw new Error('not a Radiance HDR file (bad magic)');

  var formatSeen = false, width = 0, height = 0;
  var dimensionsRe = /^\s*-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/;
  var formatRe = /^\s*FORMAT=(\S+)\s*$/;
  while (pos < buf.length) {
    var line = readLine();
    if (line === '') continue;   /* blank line: header/body separator once dimensions are known below */
    if (line.charAt(0) === '#') continue;
    var fm = formatRe.exec(line);
    if (fm) formatSeen = true;
    var dm = dimensionsRe.exec(line);
    if (dm) { height = parseInt(dm[1], 10); width = parseInt(dm[2], 10); break; }
  }
  if (!formatSeen) throw new Error('missing FORMAT in HDR header');
  if (!width || !height) throw new Error('missing or invalid resolution line');
  if (width * height > MAX_PIXELS) throw new Error('image is unreasonably large');

  var body = buf.subarray(pos);
  var rgbe = readHdrScanlines(body, width, height);   /* Uint8Array, 4 bytes/pixel: R,G,B,E */

  var floatRGB = new Float32Array(width * height * 3);
  for (var i = 0, n = width * height; i < n; i++) {
    var so = i * 4, e = rgbe[so + 3];
    var scale = e === 0 ? 0 : Math.pow(2, e - 128) / 255;
    var d = i * 3;
    floatRGB[d] = rgbe[so] * scale;
    floatRGB[d + 1] = rgbe[so + 1] * scale;
    floatRGB[d + 2] = rgbe[so + 2] * scale;
  }
  return { width: width, height: height, data: floatRGB };
}

function readHdrScanlines(body, w, h) {
  var out = new Uint8Array(4 * w * h);
  var newRle = w >= 8 && w <= 0x7fff && body.length >= 4 &&
    body[0] === 2 && body[1] === 2 && !(body[2] & 0x80);
  if (!newRle) {
    /* Flat (uncompressed) scanlines: w*h pixels of 4 bytes each, already
       in the right order — no decode needed beyond a length check. */
    if (body.length < 4 * w * h) throw new Error('truncated flat HDR data');
    out.set(body.subarray(0, 4 * w * h));
    return out;
  }
  var pos = 0, offset = 0;
  var scanline = new Uint8Array(4 * w);
  for (var row = 0; row < h; row++) {
    if (pos + 4 > body.length) throw new Error('truncated HDR scanline header');
    if (body[pos] !== 2 || body[pos + 1] !== 2 || ((body[pos + 2] << 8) | body[pos + 3]) !== w) {
      throw new Error('bad or unsupported HDR scanline format at row ' + row);
    }
    pos += 4;
    var ptr = 0, ptrEnd = 4 * w;
    while (ptr < ptrEnd) {
      if (pos >= body.length) throw new Error('truncated HDR scanline data at row ' + row);
      var count = body[pos++];
      if (count > 128) {
        count -= 128;
        if (count === 0 || ptr + count > ptrEnd) throw new Error('bad HDR RLE run at row ' + row);
        var value = body[pos++];
        for (var i = 0; i < count; i++) scanline[ptr++] = value;
      } else {
        if (count === 0 || ptr + count > ptrEnd) throw new Error('bad HDR literal run at row ' + row);
        scanline.set(body.subarray(pos, pos + count), ptr);
        ptr += count; pos += count;
      }
    }
    /* Channel-planar within the scanline (all R, then all G, then all B,
       then all E) -> interleave into RGBE per pixel. */
    for (var x = 0; x < w; x++) {
      out[offset]     = scanline[x];
      out[offset + 1] = scanline[w + x];
      out[offset + 2] = scanline[2 * w + x];
      out[offset + 3] = scanline[3 * w + x];
      offset += 4;
    }
  }
  return out;
}

/* Writes a minimal, valid new-RLE Radiance HDR file — used by
   test/hdr-preview-test.js to round-trip real bytes through readHdr()
   rather than trusting the decoder against nothing. Not used by the app
   itself (Kanvaz never needs to WRITE an HDR). */
function writeHdrForTest(width, height, floatRGB) {
  var header = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ' + height + ' +X ' + width + '\n', 'latin1');
  var rows = [];
  for (var y = 0; y < height; y++) {
    var r = Buffer.alloc(width), g = Buffer.alloc(width), b = Buffer.alloc(width), e = Buffer.alloc(width);
    for (var x = 0; x < width; x++) {
      var o = (y * width + x) * 3;
      var mr = floatRGB[o], mg = floatRGB[o + 1], mb = floatRGB[o + 2];
      var m = Math.max(mr, mg, mb);
      var exp = 0, scale = 0;
      if (m > 1e-32) {
        var f = frexp(m);
        exp = f.exp + 128;
        scale = f.mantissa * 256 / m;
      }
      r[x] = clamp8(mr * scale); g[x] = clamp8(mg * scale); b[x] = clamp8(mb * scale); e[x] = exp;
    }
    var scanHeader = Buffer.from([2, 2, (width >> 8) & 0xff, width & 0xff]);
    rows.push(scanHeader, rleEncodeChannel(r), rleEncodeChannel(g), rleEncodeChannel(b), rleEncodeChannel(e));
  }
  return Buffer.concat([header].concat(rows));
}
function clamp8(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function frexp(v) {
  if (v === 0) return { mantissa: 0, exp: 0 };
  var exp = Math.ceil(Math.log2(Math.abs(v)));
  var mantissa = v / Math.pow(2, exp);
  if (Math.abs(mantissa) >= 1) { mantissa /= 2; exp += 1; }
  return { mantissa: mantissa, exp: exp };
}
function rleEncodeChannel(bytes) {
  /* Simple, always-valid RLE: literal runs only (skips the "encoded run"
     opcode entirely). Correct, if not maximally compact — this is a test
     fixture generator, not a production encoder Kanvaz ships. */
  var out = [];
  var i = 0;
  while (i < bytes.length) {
    var chunk = Math.min(128, bytes.length - i);
    out.push(chunk);
    for (var j = 0; j < chunk; j++) out.push(bytes[i + j]);
    i += chunk;
  }
  return Buffer.from(out);
}

/* ── OpenEXR (scoped: NONE and RLE pixel compression only) ──
   Header layout per the public OpenEXR file format spec: magic (4 bytes,
   0x76 0x2f 0x31 0x01), version (4 bytes: version number byte + 3 flag
   bytes), then a sequence of null-terminated-name attributes (name\0,
   type\0, int32 size, size bytes of value) ending with one extra \0.
   Only single-part scanline images are supported (the common case); deep/
   tiled/multipart files are refused with a clear reason rather than
   silently misread. */
var EXR_MAGIC = [0x76, 0x2f, 0x31, 0x01];
var EXR_PIXEL_TYPE = { 0: 'UINT', 1: 'HALF', 2: 'FLOAT' };

function readCString(buf, pos) {
  var end = pos;
  while (end < buf.length && buf[end] !== 0) end++;
  return { value: buf.toString('latin1', pos, end), next: end + 1 };
}

function readExrHeader(buf) {
  for (var i = 0; i < 4; i++) if (buf[i] !== EXR_MAGIC[i]) throw new Error('not an OpenEXR file (bad magic)');
  var versionByte = buf[4];
  if (versionByte !== 2) throw new Error('unsupported OpenEXR version ' + versionByte);
  var flags = buf.readUInt32LE(4) >>> 8;
  if (flags & 0x200) throw new Error('multipart EXR files are not supported');
  if (flags & 0x1000) throw new Error('deep-data EXR files are not supported');
  var isTiled = !!(flags & 0x100);
  if (isTiled) throw new Error('tiled EXR files are not supported yet — only scanline images');

  var pos = 8;
  var attrs = {};
  while (pos < buf.length) {
    if (buf[pos] === 0) { pos++; break; }   /* end of header */
    var name = readCString(buf, pos); pos = name.next;
    var type = readCString(buf, pos); pos = type.next;
    var size = buf.readInt32LE(pos); pos += 4;
    attrs[name.value] = { type: type.value, offset: pos, size: size };
    pos += size;
  }

  var channelsAttr = attrs.channels;
  var dataWindowAttr = attrs.dataWindow;
  var compressionAttr = attrs.compression;
  var lineOrderAttr = attrs.lineOrder;
  if (!channelsAttr || !dataWindowAttr || !compressionAttr) throw new Error('EXR header is missing required attributes');

  var compression = buf.readUInt8(compressionAttr.offset);
  if (compression !== 0 && compression !== 1) {
    var names = { 2: 'ZIPS', 3: 'ZIP', 4: 'PIZ', 5: 'PXR24', 6: 'B44', 7: 'B44A', 8: 'DWAA', 9: 'DWAB' };
    throw new Error('this EXR uses ' + (names[compression] || ('compression method ' + compression)) + ' compression, which Kanvaz does not decode yet — only uncompressed and RLE EXRs preview for now');
  }

  var dw = dataWindowAttr.offset;
  var xMin = buf.readInt32LE(dw), yMin = buf.readInt32LE(dw + 4), xMax = buf.readInt32LE(dw + 8), yMax = buf.readInt32LE(dw + 12);
  var width = xMax - xMin + 1, height = yMax - yMin + 1;
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw new Error('EXR data window is missing or unreasonable');

  var lineOrder = lineOrderAttr ? buf.readUInt8(lineOrderAttr.offset) : 0;   /* 0 = increasing Y (top row first), 1 = decreasing Y */

  /* channel list: repeated { name\0, pixelType int32, pLinear u8, reserved[3], xSampling int32, ySampling int32 }, ends with an extra \0 */
  var channels = [];
  var cp = channelsAttr.offset;
  while (buf[cp] !== 0) {
    var cname = readCString(buf, cp); cp = cname.next;
    var pixelType = buf.readInt32LE(cp); cp += 4;
    cp += 1 + 3;   /* pLinear + reserved */
    var xSampling = buf.readInt32LE(cp); cp += 4;
    var ySampling = buf.readInt32LE(cp); cp += 4;
    if (xSampling !== 1 || ySampling !== 1) throw new Error('subsampled EXR channels are not supported');
    channels.push({ name: cname.value, pixelType: pixelType });
  }
  cp += 1;   /* trailing \0 of the channel list */
  /* OpenEXR stores channels sorted alphabetically by name within a scanline */
  channels.sort(function(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });

  return { width: width, height: height, compression: compression, channels: channels, lineOrder: lineOrder, dataStart: pos };
}

function pixelTypeSize(pixelType) { return pixelType === 1 ? 2 : 4; }   /* HALF=2 bytes, UINT/FLOAT=4 bytes */

function halfToFloat(h) {
  var s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function readExr(buf) {
  var h = readExrHeader(buf);
  var byName = {};
  for (var i = 0; i < h.channels.length; i++) byName[h.channels[i].name] = h.channels[i];
  var rChan = byName.R || byName.r, gChan = byName.G || byName.g, bChan = byName.B || byName.b;
  var yChan = byName.Y || byName.y;   /* single-channel (luminance-only) EXRs happen — treat as grey */
  if (!rChan && !yChan) throw new Error('EXR has no R/G/B or Y channel to preview');

  var bytesPerPixelRow = 0;
  for (var c = 0; c < h.channels.length; c++) bytesPerPixelRow += pixelTypeSize(h.channels[c].pixelType);

  var pos = h.dataStart;
  var numScanlines = h.height;
  /* Scanline offset table: one int64 (as two uint32) per scanline (or per
     block-of-1, since RLE/NONE both use 1-scanline blocks) — present but
     unused here: rows are read sequentially instead, which is simpler and
     works for both lineOrder values since output is written by absolute
     row index either way. */
  pos += numScanlines * 8;

  var floatRGB = new Float32Array(h.width * h.height * 3);

  for (var row = 0; row < numScanlines; row++) {
    if (pos + 8 > buf.length) throw new Error('truncated EXR scanline table/data at row ' + row);
    var y = buf.readInt32LE(pos); pos += 4;
    var dataSize = buf.readInt32LE(pos); pos += 4;
    if (pos + dataSize > buf.length) throw new Error('truncated EXR pixel data at row ' + row);
    var rowBytes = buf.subarray(pos, pos + dataSize);
    pos += dataSize;

    var decoded = h.compression === 1 ? exrRleDecompress(rowBytes, bytesPerPixelRow * h.width) : rowBytes;
    if (decoded.length < bytesPerPixelRow * h.width) throw new Error('EXR scanline decompressed to the wrong size at row ' + row);

    /* Channels are stored planar within the row: all of channel[0]'s
       samples for every x, then all of channel[1]'s, etc. (alphabetical
       order, already sorted above). */
    var outRowIndex = y - (h.lineOrder === 1 ? 0 : 0);   /* dataWindow may not start at 0; header xMin/yMin are folded into width/height only for simplicity — see the known-limitation note below */
    if (outRowIndex < 0 || outRowIndex >= h.height) continue;   /* outside the [0,height) range this simplified reader keeps */

    var channelOffset = 0;
    for (var ci = 0; ci < h.channels.length; ci++) {
      var ch = h.channels[ci];
      var size = pixelTypeSize(ch.pixelType);
      var isTarget = ch === rChan || ch === gChan || ch === bChan || ch === yChan;
      if (isTarget) {
        var dstChannel = (ch === rChan || ch === yChan) ? 0 : (ch === gChan ? 1 : 2);
        for (var x = 0; x < h.width; x++) {
          var byteOffset = channelOffset + x * size;
          var v;
          if (ch.pixelType === 1) v = halfToFloat(decoded.readUInt16LE(byteOffset));
          else if (ch.pixelType === 2) v = decoded.readFloatLE(byteOffset);
          else v = decoded.readUInt32LE(byteOffset) / 4294967295;   /* UINT: normalise to 0..1 the way an 8/16-bit source would map */
          var dst = (outRowIndex * h.width + x) * 3 + dstChannel;
          floatRGB[dst] = v;
          if (yChan && ch === yChan) { floatRGB[dst + 1] = v; floatRGB[dst + 2] = v; }
        }
      }
      channelOffset += size * h.width;
    }
  }
  return { width: h.width, height: h.height, data: floatRGB };
}

/* OpenEXR's RLE is byte-oriented (unlike HDR's per-channel-plane RLE):
   count>0 up to 127 means (count+1) literal bytes follow; count<0 (as a
   signed byte, i.e. 128..255 unsigned) means -count copies of the next
   single byte. Output additionally needs OpenEXR's "predictor" undone
   (delta-coded then byte-deinterleaved) — both steps per the spec. */
function exrRleDecompress(input, expectedSize) {
  var out = Buffer.alloc(expectedSize);
  var ip = 0, op = 0;
  while (ip < input.length && op < expectedSize) {
    var count = input.readInt8(ip); ip++;
    if (count < 0) {
      var n = -count;
      var value = input[ip]; ip++;
      for (var i = 0; i < n && op < expectedSize; i++) out[op++] = value;
    } else {
      var len = count + 1;
      for (var j = 0; j < len && ip < input.length && op < expectedSize; j++) out[op++] = input[ip++];
    }
  }
  /* undo the delta predictor: each byte is stored as (this - previous + 128) mod 256 */
  var prev = 0;
  for (var k = 0; k < out.length; k++) {
    var v = (out[k] - 128 + prev + 256) % 256;
    // eslint-disable-next-line no-unused-vars
    prev = v;
    out[k] = v;
  }
  /* undo byte-deinterleaving: even positions were packed first, odd
     positions second — for an ODD total length that first group is the
     larger one (ceil, not floor: positions 0,2,4,...,n-1 outnumber
     1,3,5,...,n-2 by one). A real EXR scanline's byte count is always
     even (every pixel sample is 2 or 4 bytes), so this never bites a real
     file, but the function should still be correct for any input. */
  var half = (out.length + 1) >> 1;
  var deint = Buffer.alloc(out.length);
  var s1 = 0, s2 = half;
  for (var m = 0; m < out.length; m += 2) {
    deint[m] = out[s1++];
    if (m + 1 < out.length) deint[m + 1] = out[s2++];
  }
  return deint;
}

/* ── entry point, matching adobe-preview.js's previewFile() shape ── */

function previewFile(filePath, opts) {
  var maxSide = (opts && opts.maxSide) || MAX_SIDE_DEFAULT;
  try {
    var st = fs.statSync(filePath);
    if (!st.isFile()) return { ok: false, reason: 'not a regular file' };
    var buf = fs.readFileSync(filePath);
    var ext = (filePath.split('.').pop() || '').toLowerCase();
    var decoded;
    if (ext === 'exr') decoded = readExr(buf);
    else decoded = readHdr(buf);   /* .hdr / .pic share the Radiance format */

    var small = downscaleFloatRGB(decoded.width, decoded.height, decoded.data, maxSide);
    var rgba = toneMapToRgba8(small.width, small.height, small.data);
    return {
      ok: true, kind: 'image', mime: 'image/png',
      bytes: adobePreview.encodePng(small.width, small.height, rgba),
      width: small.width, height: small.height,
      note: 'Tone-mapped preview (auto-exposure + Reinhard) — not colour-managed'
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = {
  EXTENSIONS: EXTENSIONS,
  readHdr: readHdr,
  readExr: readExr,
  readExrHeader: readExrHeader,
  exrRleDecompress: exrRleDecompress,
  writeHdrForTest: writeHdrForTest,
  toneMapToRgba8: toneMapToRgba8,
  downscaleFloatRGB: downscaleFloatRGB,
  previewFile: previewFile
};
