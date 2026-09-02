/* pur-import.js — PureRef .pur file parser (main process)
   Reverse-engineered binary format based on FyorDev/PureRef-format.
   Extracts embedded PNG images + positions/scales. */

/* Audit fix (live-tested against a real PureRef 2.1.x file): the
   original reverse-engineered format only ever scanned for PNG —
   real-world boards routinely embed JPEG (confirmed: a real test file
   returned 0 images because its one embedded photo was JPEG, not PNG,
   and the scanner never even looked for a JPEG signature). Generalized
   to a list of known formats; the scan loop below finds whichever
   signature occurs EARLIEST in the remaining buffer, not just PNG's.
   Each format supplies its own head signature and a way to find where
   that specific image ends — either by scanning for a trailer (PNG's
   IEND chunk, JPEG's EOI marker, GIF's trailer byte) or, more reliably
   where the format allows it, by reading an explicit length straight
   out of the format's own header (BMP stores its total file size at a
   fixed offset — no scanning, no ambiguity). */
var IMAGE_FORMATS = [
  {
    mime: 'image/png',
    head: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    findEnd: function(buf, headIdx) {
      var foot = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
      var footIdx = indexOf(buf, foot, headIdx + 8);
      return footIdx === -1 ? -1 : footIdx + 12;
    }
  },
  {
    mime: 'image/jpeg',
    head: Buffer.from([0xFF, 0xD8, 0xFF]),
    findEnd: function(buf, headIdx) {
      var eoi = Buffer.from([0xFF, 0xD9]);
      var endIdx = indexOf(buf, eoi, headIdx + 3);
      return endIdx === -1 ? -1 : endIdx + 2;
    }
  },
  {
    mime: 'image/gif',
    head: Buffer.from('GIF89a', 'ascii'),
    findEnd: gifEnd
  },
  {
    mime: 'image/gif',
    head: Buffer.from('GIF87a', 'ascii'),
    findEnd: gifEnd
  },
  {
    mime: 'image/bmp',
    head: Buffer.from('BM', 'ascii'),
    findEnd: function(buf, headIdx) {
      /* BMP's own header stores the exact total file size (LE uint32)
         at byte offset 2 — no scanning needed, and no ambiguity the
         way a trailer-byte search could have. */
      if (headIdx + 6 > buf.length) return -1;
      var size = buf.readUInt32LE(headIdx + 2);
      var end = headIdx + size;
      return (size > 0 && end <= buf.length) ? end : -1;
    }
  }
];

/* GIF's trailer is a single byte (0x3B) — inherently less unambiguous
   than PNG/JPEG's multi-byte markers, but this is a best-effort scanner
   to begin with (see the file header note on the format being reverse-
   engineered), and a bare 0x3B this soon after a real GIF header is
   overwhelmingly likely to be the actual trailer, not a false hit. */
function gifEnd(buf, headIdx) {
  var trailerIdx = buf.indexOf(0x3B, headIdx + 6);
  return trailerIdx === -1 ? -1 : trailerIdx + 1;
}

/* Kept for readable references elsewhere in this file (item/footer
   parsing never touched image bytes directly, only IMAGE_FORMATS does). */
var GRAPHICS_IMAGE_ITEM = 34;
var GRAPHICS_TEXT_ITEM  = 32;

/* Sane upper bound on tracked entries (real images + raw 4-byte transform-
   id gaps between them). A well-formed PureRef board — even a large mood
   board — doesn't come close to this; a file that does is almost
   certainly misaligned/corrupted parsing, not real data, and would
   otherwise grind for a very long time before failing anyway. Fail fast
   instead. */
var MAX_TRACKED_ENTRIES = 50000;

/* ── Buffer reader with a moving cursor ── */

function PurReader(buf) {
  this.buf = buf;
  this.pos = 0;
}

PurReader.prototype.skip = function(n) { this.pos += n; };

PurReader.prototype.readUInt32BE = function() {
  var v = this.buf.readUInt32BE(this.pos);
  this.pos += 4;
  return v;
};

PurReader.prototype.readInt32BE = function() {
  var v = this.buf.readInt32BE(this.pos);
  this.pos += 4;
  return v;
};

PurReader.prototype.readDoubleBE = function() {
  var v = this.buf.readDoubleBE(this.pos);
  this.pos += 8;
  return v;
};

PurReader.prototype.readBigUInt64BE = function() {
  /* Node 10 may not have readBigUInt64BE — read as two uint32 */
  var hi = this.buf.readUInt32BE(this.pos);
  var lo = this.buf.readUInt32BE(this.pos + 4);
  this.pos += 8;
  return hi * 0x100000000 + lo;
};

PurReader.prototype.readUInt8 = function() {
  var v = this.buf.readUInt8(this.pos);
  this.pos += 1;
  return v;
};

PurReader.prototype.readUInt16BE = function() {
  var v = this.buf.readUInt16BE(this.pos);
  this.pos += 2;
  return v;
};

PurReader.prototype.peekUInt32BE = function(offset) {
  return this.buf.readUInt32BE(this.pos + (offset || 0));
};

PurReader.prototype.peekBigUInt64BE = function(offset) {
  var p = this.pos + (offset || 0);
  var hi = this.buf.readUInt32BE(p);
  var lo = this.buf.readUInt32BE(p + 4);
  return hi * 0x100000000 + lo;
};

PurReader.prototype.readSlice = function(n) {
  var s = this.buf.slice(this.pos, this.pos + n);
  this.pos += n;
  return s;
};

PurReader.prototype.readMatrix = function() {
  /* 48 bytes: 4 doubles used (bytes 16-24 skipped) */
  var m0 = this.readDoubleBE();
  var m1 = this.readDoubleBE();
  this.skip(8); /* unused 8 bytes */
  var m2 = this.readDoubleBE();
  var m3 = this.readDoubleBE();
  return [m0, m1, m2, m3];
};

PurReader.prototype.readString = function() {
  var len = this.readUInt32BE();
  if (len === 0) return '';
  var raw = this.buf.slice(this.pos, this.pos + len);
  this.pos += len;
  /* UTF-16 BE */
  var str = '';
  for (var i = 0; i < raw.length - 1; i += 2) {
    str += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
  }
  return str;
};

PurReader.prototype.remaining = function() {
  return this.buf.length - this.pos;
};


/* ── Main parse function ── */

function parsePurFile(buffer) {
  if (!buffer || buffer.length < 224) {
    throw new Error('File too small to be a valid PureRef file');
  }

  var r = new PurReader(buffer);

  /* Track absolute positions for image↔transform linking */
  var images = [];       /* { absStart, absEnd, pngBuf, mime } */
  var imageItems = [];   /* parsed GraphicsImageItems */
  var textItems = [];    /* parsed GraphicsTextItems (ignored for import) */

  /* ── Header ──
     Audit fix (live-tested): the original 224-byte fixed header only
     held for whichever PureRef format-version the reverse-engineering
     was based on. A real PureRef 2.1.x file has a variable-length
     version-string preamble instead, and its one embedded JPEG started
     at byte ~106 — well BEFORE the old code's r.pos=224 starting point,
     so the image scan below would search forward from 224 and skip
     straight past it. canvas/zoom were never even used in this
     function's return value, so there's nothing depending on the
     header actually being exactly 224 bytes; the image scan starts
     from 0 instead, which finds the same images either way on an
     older-format file (a signature is a signature, regardless of scan
     start point) and no longer misses images on files with a shorter
     or differently-shaped header. */
  var canvas = (buffer.length >= 144)
    ? [r.buf.readDoubleBE(112), r.buf.readDoubleBE(120), r.buf.readDoubleBE(128), r.buf.readDoubleBE(136)]
    : null;
  var zoom = (buffer.length >= 152) ? r.buf.readDoubleBE(144) : null;
  r.pos = 0;

  /* ── Read embedded images (any known format — see IMAGE_FORMATS) ──
     Finds whichever format's signature occurs EARLIEST from the current
     position, not just PNG's — a board can freely mix PNG/JPEG/GIF/BMP
     across different embedded items.

     Perf fix (caught by this file's own regression test, not just
     inspection): a naive version of this re-ran indexOf() for EVERY
     format on EVERY call, unconditionally. Each indexOf that finds
     nothing has to scan all the way to the end of the remaining buffer
     to conclude that — so on a board that's all-PNG (indexOf-favorite
     case for the other 4 formats to constantly come up empty), this
     amplified the exact O(images × buffer-length) blowup the earlier
     absStart-map fix was written specifically to eliminate (measured:
     40,000 images went from ~50ms back up to ~51s). Fixed by caching
     each format's next known position and only re-searching a format
     once we've advanced past its cached hit — every byte in the buffer
     still only gets scanned a bounded number of times overall, same
     complexity class as the single-format version had. */
  var formatNextIdx = [];
  for (var fi0 = 0; fi0 < IMAGE_FORMATS.length; fi0++) formatNextIdx.push(-2); /* -2 = not searched yet */

  function findNextImage(fromPos) {
    var best = null;
    for (var f = 0; f < IMAGE_FORMATS.length; f++) {
      if (formatNextIdx[f] === -2 || (formatNextIdx[f] !== -1 && formatNextIdx[f] < fromPos)) {
        formatNextIdx[f] = indexOf(r.buf, IMAGE_FORMATS[f].head, fromPos);
      }
      var idx = formatNextIdx[f];
      if (idx !== -1 && (!best || idx < best.headIdx)) {
        best = { headIdx: idx, format: IMAGE_FORMATS[f] };
      }
    }
    return best;
  }

  var hitItemMarker = false;
  imageScan:
  while (r.remaining() > 12) {
    var next = findNextImage(r.pos);
    if (!next) break;
    var headIdx = next.headIdx;

    /* Duplicates (4-byte transform ID refs) before the next image.
       Audit fix (live-tested against a real file): this used to
       unconditionally treat every byte up to the next image signature
       as a raw dup entry — but a real PureRef 2.1.x file interleaves
       GraphicsImageItem/GraphicsTextItem records BETWEEN images, not
       strictly after all of them. Without this check, a real item
       record sitting in that gap got shredded into meaningless 4-byte
       "dup" chunks, and the scan sailed on toward the next image
       signature (in this file, an internal thumbnail) — completely
       skipping the transform data the image needed to ever be linked
       to a position on the board, so it silently came back as zero
       results despite the image bytes themselves being found. Now:
       the instant the same type-marker check the item-loop itself uses
       matches, stop scanning for more images entirely so the item loop
       below picks up from exactly here. */
    while (r.pos < headIdx && (headIdx - r.pos) >= 4) {
      if (r.remaining() >= 12) {
        var maybeType = r.peekUInt32BE(8);
        if (maybeType === GRAPHICS_IMAGE_ITEM || maybeType === GRAPHICS_TEXT_ITEM) {
          hitItemMarker = true;
          break imageScan;
        }
      }
      if (images.length > MAX_TRACKED_ENTRIES) {
        throw new Error('This .pur file looks corrupted or uses an unsupported format variant (too many entries to import safely)');
      }
      var dupBuf = r.readSlice(4);
      images.push({ absStart: r.pos - 4, absEnd: r.pos, pngBuf: dupBuf, isDup: true });
    }

    var imgEnd = next.format.findEnd(r.buf, headIdx);
    if (imgEnd === -1) break;

    var imgBuf = r.buf.slice(headIdx, imgEnd);
    images.push({ absStart: headIdx, absEnd: imgEnd, pngBuf: imgBuf, isDup: false, mime: next.format.mime });
    r.pos = imgEnd;
  }

  /* Remaining 4-byte refs after last PNG, before items start */
  while (r.remaining() >= 12) {
    var typeCheck = r.peekUInt32BE(8);
    if (typeCheck === GRAPHICS_IMAGE_ITEM || typeCheck === GRAPHICS_TEXT_ITEM) break;
    if (r.remaining() < 4) break;
    if (images.length > MAX_TRACKED_ENTRIES) {
      throw new Error('This .pur file looks corrupted or uses an unsupported format variant (too many entries to import safely)');
    }
    var dupBuf2 = r.readSlice(4);
    images.push({ absStart: r.pos - 4, absEnd: r.pos, pngBuf: dupBuf2, isDup: true });
  }

  /* ── Read items (transforms) ── */
  while (r.remaining() >= 12) {
    var itemType;
    try {
      itemType = r.peekUInt32BE(8);
    } catch (e) {
      break;
    }

    if (itemType === GRAPHICS_IMAGE_ITEM) {
      try {
        imageItems.push(readGraphicsImageItem(r));
      } catch (e) {
        /* Corrupt item — skip to next parseable section */
        break;
      }
    } else if (itemType === GRAPHICS_TEXT_ITEM) {
      try {
        readGraphicsTextItem(r);
      } catch (e) {
        break;
      }
    } else {
      break;
    }
  }

  /* ── Footer: folder location + ID↔address mapping ── */
  var idToAddress = {};
  if (r.remaining() > 4) {
    try { r.readString(); } catch (e) { /* folder location — ignore */ }
  }

  for (var m = 0; m < imageItems.length && r.remaining() >= 20; m++) {
    var refId = r.readUInt32BE();
    var refStart = r.readBigUInt64BE();
    var refEnd = r.readBigUInt64BE();
    idToAddress[refId] = { start: refStart, end: refEnd };
  }

  /* ── Link transforms to images ──
     Audit fix: this used to be a nested `for` inside a `for` (every
     transform re-scanning the ENTIRE images array looking for a
     matching absStart). `images` routinely holds thousands of entries
     on real files — the raw 4-byte transform-id gaps between embedded
     PNGs each become one array entry (see the PNG-scan loop above) —
     so this was O(imageItems × images), which on a large board turned
     a sub-second parse into a multi-minute-or-worse hang. A one-time
     absStart→index map makes each lookup O(1) instead. */
  var byAbsStart = {};
  for (var bi = 0; bi < images.length; bi++) {
    if (!images[bi].isDup) byAbsStart[images[bi].absStart] = bi;
  }

  for (var t = 0; t < imageItems.length; t++) {
    var item = imageItems[t];
    var addr = idToAddress[item.id];
    if (!addr) continue;

    var imgIdx = byAbsStart[addr.start];
    if (imgIdx !== undefined) {
      if (!images[imgIdx].transforms) images[imgIdx].transforms = [];
      images[imgIdx].transforms.push(item);
    }
  }

  /* ── Handle duplicates ──
     Duplicate images are 4-byte buffers containing the transform.id of
     the original. Same fix as above: this used to re-scan every image
     (and every one of ITS transforms) per duplicate — O(images² ×
     avg transforms) in the worst case. A one-time transform-id→image-
     index map makes it O(images) total instead. */
  var transformIdToImgIndex = {};
  for (var oi = 0; oi < images.length; oi++) {
    if (images[oi].isDup || !images[oi].transforms) continue;
    for (var oti = 0; oti < images[oi].transforms.length; oti++) {
      transformIdToImgIndex[images[oi].transforms[oti].id] = oi;
    }
  }

  for (var d = 0; d < images.length; d++) {
    if (images[d].isDup && images[d].pngBuf.length === 4) {
      var dupId = images[d].pngBuf.readUInt32BE(0);
      if (dupId === 0xFFFFFFFF) continue; /* image link, not duplicate */
      var origIdx = transformIdToImgIndex[dupId];
      if (origIdx !== undefined && images[d].transforms) {
        for (var dt = 0; dt < images[d].transforms.length; dt++) {
          images[origIdx].transforms.push(images[d].transforms[dt]);
        }
      }
    }
  }

  /* ── Build result: only real images with transforms ── */
  var results = [];
  for (var ri = 0; ri < images.length; ri++) {
    var im = images[ri];
    if (im.isDup || !im.transforms || im.transforms.length === 0) continue;

    var b64 = im.pngBuf.toString('base64');
    /* Audit fix (live-tested): this was hardcoded to image/png regardless
       of what was actually extracted — harmless for an actual PNG, but
       a JPEG/GIF/BMP served with the wrong MIME in its data: URL can
       fail to decode in some contexts even when the underlying bytes
       are perfectly valid. Uses the format that actually matched. */
    var dataUrl = 'data:' + (im.mime || 'image/png') + ';base64,' + b64;

    for (var ti = 0; ti < im.transforms.length; ti++) {
      var tr = im.transforms[ti];
      results.push({
        dataUrl: dataUrl,
        x: Math.round(tr.x),
        y: Math.round(tr.y),
        scaleX: tr.matrix[0],
        scaleY: tr.matrix[3],
        name: tr.name || tr.source || 'image',
        zLayer: tr.zLayer
      });
    }
  }

  /* ── Fallback: grid-arrange raw images if transform-linking found
     nothing ──
     Audit fix (live-tested against a real PureRef 2.1.x file): the
     transform/item byte layout above is reverse-engineered from an
     older format version, and a real file from a newer PureRef build
     can interleave items differently enough that linking finds zero
     matches even though the images themselves were extracted
     perfectly fine. Previously that meant the import came back
     completely empty — "No images found" — despite the file
     genuinely containing real photos, which is a much worse failure
     mode than "found the images but couldn't recover their exact
     PureRef layout". If linking produced nothing, fall back to every
     distinct real (non-dup) image found in the byte scan, arranged in
     a simple grid instead of at their original PureRef positions.
     Small (<2KB) images are skipped here specifically because
     PureRef's own internal UI thumbnails are consistently tiny
     compared to actual embedded photos — a real user-placed image is
     essentially never that small. */
  if (results.length === 0) {
    var GRID_COLS = 4, GRID_CELL = 320, GRID_GAP = 24, MIN_FALLBACK_BYTES = 2048;
    var col = 0, row = 0;
    for (var fi = 0; fi < images.length; fi++) {
      var fim = images[fi];
      if (fim.isDup || !fim.mime || fim.pngBuf.length < MIN_FALLBACK_BYTES) continue;
      results.push({
        dataUrl: 'data:' + fim.mime + ';base64,' + fim.pngBuf.toString('base64'),
        x: col * (GRID_CELL + GRID_GAP),
        y: row * (GRID_CELL + GRID_GAP),
        scaleX: 1,
        scaleY: 1,
        name: 'image-' + (results.length + 1),
        zLayer: results.length
      });
      col++;
      if (col >= GRID_COLS) { col = 0; row++; }
    }
  }

  /* Sort by z-layer so cards stack correctly */
  results.sort(function(a, b) { return a.zLayer - b.zLayer; });

  return { images: results, count: results.length };
}


/* ── Item readers ── */

function readGraphicsImageItem(r) {
  var transformEnd = r.readBigUInt64BE();
  var stdTextLen = r.peekUInt32BE(4);
  r.skip(12 + stdTextLen);

  var bruteForce = false;
  if (r.peekUInt32BE(0) === 0) {
    bruteForce = true;
    r.skip(4);
  }

  var source = '';
  if (r.peekInt32BE(0) === -1) {
    r.skip(4);
  } else {
    source = r.readString();
  }

  var name = '';
  if (!bruteForce) {
    if (r.peekInt32BE(0) === -1) {
      r.skip(4);
    } else {
      name = r.readString();
    }
  }

  r.skip(8); /* unknown float */

  var matrix = r.readMatrix();
  var x = r.readDoubleBE();
  var y = r.readDoubleBE();

  r.skip(8); /* second unknown float */

  var id = r.readUInt32BE();
  var zLayer = r.readDoubleBE();

  /* matrixBeforeCrop */
  r.readMatrix();
  /* xCrop, yCrop */
  r.readDoubleBE();
  r.readDoubleBE();
  /* scaleCrop */
  r.readDoubleBE();

  /* Crop points */
  var pointCount = r.readUInt32BE();
  for (var p = 0; p < pointCount; p++) {
    r.skip(4);  /* unknown 4 bytes per point */
    r.readDoubleBE(); /* x */
    r.readDoubleBE(); /* y */
  }

  /* Read number_of_children from near the end, skip remaining */
  var bytesLeft = transformEnd - r.pos;
  if (bytesLeft > 0) r.skip(bytesLeft);

  /* Text children — simplified: skip them for import purposes */
  /* We'd need to peek at the count before the skip, but for import
     we only care about images. The transformEnd skip handles it. */

  return {
    id: id,
    x: x,
    y: y,
    matrix: matrix,
    zLayer: zLayer,
    source: source,
    name: name
  };
}

function readGraphicsTextItem(r) {
  var transformEnd = r.readBigUInt64BE();
  /* Skip everything — we don't import text items */
  var bytesLeft = transformEnd - r.pos;
  if (bytesLeft > 0) r.skip(bytesLeft);
  return {};
}

/* Add peekInt32BE helper */
PurReader.prototype.peekInt32BE = function(offset) {
  return this.buf.readInt32BE(this.pos + (offset || 0));
};


/* ── Buffer.indexOf polyfill for older Node ── */

function indexOf(haystack, needle, fromIndex) {
  if (typeof haystack.indexOf === 'function') {
    return haystack.indexOf(needle, fromIndex);
  }
  /* Manual search */
  for (var i = fromIndex || 0; i <= haystack.length - needle.length; i++) {
    var found = true;
    for (var j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}


module.exports = { parsePurFile: parsePurFile };
