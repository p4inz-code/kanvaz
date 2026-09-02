/* pur-import.js — PureRef .pur file parser (main process)
   Reverse-engineered binary format based on FyorDev/PureRef-format.
   Extracts embedded PNG images + positions/scales. */

var PNG_HEAD = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
var PNG_FOOT = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

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
  var images = [];       /* { absStart, absEnd, pngBuf } */
  var imageItems = [];   /* parsed GraphicsImageItems */
  var textItems = [];    /* parsed GraphicsTextItems (ignored for import) */

  /* ── Header (224 bytes) ── */
  var canvas = [
    r.buf.readDoubleBE(112),
    r.buf.readDoubleBE(120),
    r.buf.readDoubleBE(128),
    r.buf.readDoubleBE(136)
  ];
  var zoom = r.buf.readDoubleBE(144);
  r.skip(224);

  /* ── Read PNG images ── */
  /* Scan for PNG headers and footers in sequence */
  while (r.remaining() > 12) {
    var headIdx = indexOf(r.buf, PNG_HEAD, r.pos);
    if (headIdx === -1) break;

    /* Duplicates (4-byte transform ID refs) before the next PNG */
    while (r.pos < headIdx && (headIdx - r.pos) >= 4) {
      if (images.length > MAX_TRACKED_ENTRIES) {
        throw new Error('This .pur file looks corrupted or uses an unsupported format variant (too many entries to import safely)');
      }
      var dupBuf = r.readSlice(4);
      images.push({ absStart: r.pos - 4, absEnd: r.pos, pngBuf: dupBuf, isDup: true });
    }

    var footIdx = indexOf(r.buf, PNG_FOOT, headIdx);
    if (footIdx === -1) break;
    var pngEnd = footIdx + 12;

    var pngBuf = r.buf.slice(headIdx, pngEnd);
    images.push({ absStart: headIdx, absEnd: pngEnd, pngBuf: pngBuf, isDup: false });
    r.pos = pngEnd;
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
    var dataUrl = 'data:image/png;base64,' + b64;

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
