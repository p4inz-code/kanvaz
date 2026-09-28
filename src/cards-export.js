/* cards-export.js — export-as-format converter (v9.7.0 split out of cards.js)
 *
 * Pulled out of cards.js as the first step in bringing that file's size
 * down — this piece was already self-contained enough to move cleanly:
 * it only ever needed cards.js's PUBLIC API (KanvazCards.getCard), never
 * its private `cards` object or any other closure-private state, so the
 * extraction needed no interface changes on either side. cards.js's own
 * public exportCardsAsFormat is now a thin delegate to this module (see
 * cards.js) — external callers (app.js's Export as… dialog and context
 * menu) are unaffected and keep calling KanvazCards.exportCardsAsFormat
 * exactly as before.
 *
 * Distinct from cards.js's own exportAsImage(), which flattens a
 * SELECTION onto one composited canvas (board/selection export) — this
 * re-encodes each image/GIF/video card's own original media into its
 * own separate output file. Direct request: "kanvaz becomes a sort of
 * converter too... someone just copy pasted pics and wants now to
 * create a set of img locally, kanvaz allows that without visiting any
 * converter site."
 */

var KanvazCardsExport = (function() {

  /* Resolves to a canvas holding card `c`'s own current visual frame at
     its natural resolution — an <img> decode for image/gif, or the live
     <video> element's current frame for video (falls back to a fresh
     offscreen video seeked to 10%-in, same "avoid a black frame-0 fade
     in" reasoning the Map View video-thumbnail decoder already uses, if
     the card's own video isn't in the DOM/loaded for some reason). */
  function cardToExportCanvas(c, scale) {
    scale = (typeof scale === 'number' && isFinite(scale) && scale > 0) ? Math.min(1, scale) : 1;
    return new Promise(function(resolve, reject) {
      if (c.type === 'image' || c.type === 'gif') {
        var img = new Image();
        img.onload = function() {
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round((img.naturalWidth || c.naturalW || c.w) * scale));
          cv.height = Math.max(1, Math.round((img.naturalHeight || c.naturalH || c.h) * scale));
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv);
        };
        img.onerror = function() { reject(new Error('could not decode this card\'s image data')); };
        img.src = c.dataUrl;
        return;
      }
      if (c.type === 'video') {
        var liveEl = document.getElementById(c.id);
        var liveVideo = liveEl && liveEl.querySelector('video');
        function frameFromVideo(v, cleanup) {
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round((v.videoWidth || c.naturalW || c.w) * scale));
          cv.height = Math.max(1, Math.round((v.videoHeight || c.naturalH || c.h) * scale));
          var ctx = cv.getContext('2d');
          try {
            ctx.drawImage(v, 0, 0, cv.width, cv.height);
            resolve(cv);
          } catch (e) {
            reject(e);
          } finally {
            if (cleanup) cleanup();
          }
        }
        if (liveVideo && liveVideo.readyState >= 2) {
          frameFromVideo(liveVideo, null);
          return;
        }
        var offVideo = document.createElement('video');
        offVideo.muted = true;
        offVideo.preload = 'auto';
        offVideo.onloadeddata = function() {
          offVideo.currentTime = Math.min(offVideo.duration * 0.1 || 0, 1);
        };
        offVideo.onseeked = function() {
          frameFromVideo(offVideo, function() { offVideo.src = ''; });
        };
        offVideo.onerror = function() { reject(new Error('could not decode this card\'s video data')); };
        offVideo.src = c.dataUrl;
        return;
      }
      reject(new Error('unsupported card type for export: ' + c.type));
    });
  }

  var EXPORT_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' };

  /* BMP — direct request ("only these many formats? add more"). Chromium's
     canvas.toDataURL() only ever produces png/jpeg/webp (that's the whole
     list per spec, browsers don't extend it), so a real 4th format needs
     its own encoder, not just another toDataURL() call. Hand-rolled
     rather than a dependency: uncompressed 24-bit BMP is a genuinely
     simple, well-specified format (54-byte header + bottom-up BGR rows,
     each padded to a 4-byte boundary) — a few dozen lines, no library
     needed, matching this app's existing PSD/HDR/EXR readers' own
     "understand the format, don't just wrap someone else's parser"
     convention. Returns a Promise (Blob->FileReader, not a manual base64
     loop — String.fromCharCode.apply on a multi-megabyte pixel buffer is
     both slow and can blow the call stack). */
  function canvasToBmpDataUrl(cv) {
    var w = cv.width, h = cv.height;
    var imgData = cv.getContext('2d').getImageData(0, 0, w, h).data;
    var rowSize = Math.floor((24 * w + 31) / 32) * 4;
    var pixelArraySize = rowSize * h;
    var fileSize = 54 + pixelArraySize;
    var buf = new ArrayBuffer(fileSize);
    var view = new DataView(buf);
    view.setUint8(0, 0x42); view.setUint8(1, 0x4D);       /* 'BM' */
    view.setUint32(2, fileSize, true);
    view.setUint32(6, 0, true);
    view.setUint32(10, 54, true);                          /* pixel data offset */
    view.setUint32(14, 40, true);                           /* DIB header size */
    view.setInt32(18, w, true);
    view.setInt32(22, h, true);                             /* positive = bottom-up */
    view.setUint16(26, 1, true);                            /* planes */
    view.setUint16(28, 24, true);                           /* bits per pixel */
    view.setUint32(30, 0, true);                            /* BI_RGB, no compression */
    view.setUint32(34, pixelArraySize, true);
    view.setInt32(38, 2835, true);                          /* ~72 DPI */
    view.setInt32(42, 2835, true);
    view.setUint32(46, 0, true);
    view.setUint32(50, 0, true);
    var offset = 54;
    for (var y = h - 1; y >= 0; y--) {
      for (var x = 0; x < w; x++) {
        var srcIdx = (y * w + x) * 4;
        view.setUint8(offset++, imgData[srcIdx + 2]); /* B */
        view.setUint8(offset++, imgData[srcIdx + 1]); /* G */
        view.setUint8(offset++, imgData[srcIdx]);     /* R */
      }
      for (var pad = 0; pad < rowSize - w * 3; pad++) view.setUint8(offset++, 0);
    }
    var blob = new Blob([buf], { type: 'image/bmp' });
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(new Error('BMP encode failed')); };
      reader.readAsDataURL(blob);
    });
  }

  function exportCardsAsFormat(ids, format, quality, scale) {
    var fmt = EXPORT_MIME[format] ? format : 'png';
    var q = (typeof quality === 'number' && isFinite(quality)) ? Math.max(0.1, Math.min(1, quality)) : 0.92;
    var targets = [];
    for (var i = 0; i < ids.length; i++) {
      var c = KanvazCards.getCard(ids[i]);
      if (c && (c.type === 'image' || c.type === 'gif' || c.type === 'video')) targets.push(c);
    }
    if (!targets.length) {
      if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Nothing exportable in this selection', 'error');
      return;
    }
    Promise.all(targets.map(function(c) {
      return cardToExportCanvas(c, scale).then(function(cv) {
        var dataUrlPromise = (fmt === 'bmp') ? canvasToBmpDataUrl(cv)
          : Promise.resolve(fmt === 'png' ? cv.toDataURL('image/png') : cv.toDataURL(EXPORT_MIME[fmt], q));
        return dataUrlPromise.then(function(dataUrl) { return { name: c.name || c.type, dataUrl: dataUrl }; });
      }).catch(function(e) {
        console.error('[Kanvaz] export failed for card ' + c.id + ':', e.message);
        return null;
      });
    })).then(function(files) {
      files = files.filter(function(f) { return f; });
      if (!files.length) {
        if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Export failed for every selected card', 'error');
        return;
      }
      if (typeof KanvazBridge === 'undefined') return;
      if (files.length === 1) {
        if (!KanvazBridge.exportImageSave) return;
        KanvazBridge.exportImageSave(files[0].name, files[0].dataUrl, fmt).then(function(res) {
          if (!res || res.cancelled) return;
          if (!res.ok) { if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Export failed — ' + (res.error || 'unknown error'), 'error'); return; }
          if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Exported as ' + fmt.toUpperCase());
        });
      } else {
        if (!KanvazBridge.exportImagesBatch) return;
        KanvazBridge.exportImagesBatch(files, fmt).then(function(res) {
          if (!res || res.cancelled) return;
          if (!res.ok) { if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Export failed — ' + (res.error || 'unknown error'), 'error'); return; }
          if (typeof KanvazUI !== 'undefined') KanvazUI.toast('Exported ' + res.written + ' file' + (res.written === 1 ? '' : 's') + ' as ' + fmt.toUpperCase());
        });
      }
    });
  }

  return {
    cardToExportCanvas: cardToExportCanvas,
    canvasToBmpDataUrl: canvasToBmpDataUrl,
    exportCardsAsFormat: exportCardsAsFormat
  };

})();
