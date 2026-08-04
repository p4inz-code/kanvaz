/* media.js — media loading, type detection, size helpers */

var KanvazMedia = (function() {

  var IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'webp'];
  var GIF_EXTS   = ['gif'];
  var VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'avi'];
  var AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a'];

  var MAX_DROP_WIDTH = 600;
  var AUDIO_CARD_W   = 280;
  var AUDIO_CARD_H   = 100;

  /* ── Type detection ── */

  function getType(ext) {
    var e = ext.toLowerCase().replace('.', '');
    if (IMAGE_EXTS.indexOf(e) !== -1) return 'image';
    if (GIF_EXTS.indexOf(e)   !== -1) return 'gif';
    if (VIDEO_EXTS.indexOf(e) !== -1) return 'video';
    if (AUDIO_EXTS.indexOf(e) !== -1) return 'audio';
    return null;
  }

  function getTypeFromName(name) {
    var parts = name.split('.');
    var ext = parts[parts.length - 1];
    return getType(ext);
  }

  function getTypeFromDataUrl(dataUrl) {
    if (dataUrl.indexOf('image/gif') !== -1)   return 'gif';
    if (dataUrl.indexOf('video/')    !== -1)   return 'video';
    if (dataUrl.indexOf('audio/')    !== -1)   return 'audio';
    if (dataUrl.indexOf('image/')    !== -1)   return 'image';
    return null;
  }

  function isSupported(ext) {
    return getType(ext) !== null;
  }

  /* ── Natural size from image/gif dataUrl ── */

  /* Audit fix: both size-detection functions below relied solely on
     onload/onerror (or onloadedmetadata/onerror) firing — for a
     malformed/truncated file that the decoder neither accepts nor
     definitively rejects, neither ever fires, and the drop/paste
     operation just silently hangs forever with no toast, no fallback,
     nothing. A timeout guarantees the callback always eventually runs.
     8s mirrors the same reasoning already used for checkForUpdates()'s
     fetch() timeout in ui.js ("fetch never times out on its own"). */
  var MEDIA_METADATA_TIMEOUT_MS = 8000;

  function getNaturalSize(dataUrl, callback) {
    var img = new Image();
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      console.warn('[Kanvaz] image metadata load timed out, using fallback size');
      callback(300, 200);
    }, MEDIA_METADATA_TIMEOUT_MS);
    img.onload = function() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      callback(img.naturalWidth, img.naturalHeight);
    };
    img.onerror = function() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      callback(300, 200);
    };
    img.src = dataUrl;
  }

  /* ── Natural size from video dataUrl ── */

  function getVideoSize(dataUrl, callback) {
    var vid = document.createElement('video');
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      console.warn('[Kanvaz] video metadata load timed out, using fallback size');
      callback(400, 300);
      vid.src = '';
    }, MEDIA_METADATA_TIMEOUT_MS);
    vid.onloadedmetadata = function() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      var w = vid.videoWidth  || 400;
      var h = vid.videoHeight || 300;
      callback(w, h);
      vid.src = '';
    };
    vid.onerror = function() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      callback(400, 300);
    };
    vid.src = dataUrl;
  }

  /* ── Cap size to MAX_DROP_WIDTH, preserve aspect ── */

  function capSize(w, h) {
    var maxW = MAX_DROP_WIDTH;
    if (typeof KanvazUI_Extended !== 'undefined') {
      var s = KanvazUI_Extended.getSettings();
      if (s && s.defaultCardW && s.defaultCardW >= 80) maxW = s.defaultCardW;
    }
    /* Fit within a maxW x maxW box, preserving aspect ratio, capping
       whichever dimension overflows more. Previously only checked width,
       so a tall portrait image (e.g. 300x3000 — a concept sheet or film
       strip) passed through completely unscaled and landed on the
       canvas 10x taller than wide. */
    if (w <= maxW && h <= maxW) return { w: w, h: h };
    var ratio = Math.min(maxW / w, maxW / h);
    return { w: Math.round(w * ratio), h: Math.round(h * ratio) };
  }

  /* ── Load from file path via bridge ── */

  function loadFromPath(filePath, callback) {
    KanvazBridge.loadMedia(filePath).then(function(result) {
      if (!result.ok) {
        callback(null, result.error, result);
        return;
      }
      var type = getType(result.ext);
      if (!type) {
        callback(null, 'FILE_TYPE_INVALID', result);
        return;
      }
      result.type = type;

      if (type === 'video') {
        getVideoSize(result.dataUrl, function(w, h) {
          var sz = capSize(w, h);
          result.naturalW = w;
          result.naturalH = h;
          result.displayW = sz.w;
          result.displayH = sz.h;
          callback(result, null);
        });
      } else if (type === 'audio') {
        result.naturalW = AUDIO_CARD_W;
        result.naturalH = AUDIO_CARD_H;
        result.displayW = AUDIO_CARD_W;
        result.displayH = AUDIO_CARD_H;
        callback(result, null);
      } else {
        getNaturalSize(result.dataUrl, function(w, h) {
          var sz = capSize(w, h);
          result.naturalW = w;
          result.naturalH = h;
          result.displayW = sz.w;
          result.displayH = sz.h;
          callback(result, null);
        });
      }
    }).catch(function(e) {
      console.warn('[Kanvaz] loadMedia IPC failed:', e);
      callback(null, 'IPC_FAIL', null);
    });
  }

  /* ── Load from File object (drag-drop) ── */

  function loadFromFile(file, callback) {
    if (!file.path) {
      callback(null, 'FILE_NOT_FOUND');
      return;
    }
    loadFromPath(file.path, callback);
  }

  /* ── Load from dataUrl (clipboard paste) ── */

  function loadFromDataUrl(dataUrl, name, callback) {
    var type = getTypeFromDataUrl(dataUrl);
    if (!type) {
      callback(null, 'FILE_TYPE_INVALID');
      return;
    }
    var result = {
      ok: true,
      dataUrl: dataUrl,
      name: name || 'pasted-image.png',
      type: type,
      originalPath: null,
      sizeMB: 0
    };

    if (type === 'video') {
      getVideoSize(dataUrl, function(w, h) {
        var sz = capSize(w, h);
        result.naturalW = w;
        result.naturalH = h;
        result.displayW = sz.w;
        result.displayH = sz.h;
        callback(result, null);
      });
    } else if (type === 'audio') {
      /* Fixed card size, same as loadFromPath's audio branch — audio has
         no visual "natural size" to measure, and running it through the
         image-based getNaturalSize() below would just fail and fall
         back to a wrong-shaped 300x200 default. */
      result.naturalW = AUDIO_CARD_W;
      result.naturalH = AUDIO_CARD_H;
      result.displayW = AUDIO_CARD_W;
      result.displayH = AUDIO_CARD_H;
      callback(result, null);
    } else {
      getNaturalSize(dataUrl, function(w, h) {
        var sz = capSize(w, h);
        result.naturalW = w;
        result.naturalH = h;
        result.displayW = sz.w;
        result.displayH = sz.h;
        callback(result, null);
      });
    }
  }

  /* ── Format helpers ── */

  function formatSize(mb) {
    if (mb < 1) return Math.round(mb * 1024) + ' KB';
    return mb.toFixed(1) + ' MB';
  }

  function formatTime(seconds) {
    /* Audit fix: some malformed/streamed video files report duration as
       NaN or Infinity — this had no guard, producing a literal "NaN:NaN"
       label instead of a sensible placeholder. */
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  return {
    getType:          getType,
    getTypeFromName:  getTypeFromName,
    isSupported:      isSupported,
    getNaturalSize:   getNaturalSize,
    getVideoSize:     getVideoSize,
    capSize:          capSize,
    loadFromPath:     loadFromPath,
    loadFromFile:     loadFromFile,
    loadFromDataUrl:  loadFromDataUrl,
    formatSize:       formatSize,
    formatTime:       formatTime,
    MAX_DROP_WIDTH:   MAX_DROP_WIDTH
  };

})();
