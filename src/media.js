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
    if (dataUrl.indexOf('image/')    !== -1)   return 'image';
    return null;
  }

  function isSupported(ext) {
    return getType(ext) !== null;
  }

  /* ── Natural size from image/gif dataUrl ── */

  function getNaturalSize(dataUrl, callback) {
    var img = new Image();
    img.onload = function() {
      callback(img.naturalWidth, img.naturalHeight);
    };
    img.onerror = function() {
      callback(300, 200);
    };
    img.src = dataUrl;
  }

  /* ── Natural size from video dataUrl ── */

  function getVideoSize(dataUrl, callback) {
    var vid = document.createElement('video');
    vid.onloadedmetadata = function() {
      var w = vid.videoWidth  || 400;
      var h = vid.videoHeight || 300;
      callback(w, h);
      vid.src = '';
    };
    vid.onerror = function() {
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
    if (w <= maxW) return { w: w, h: h };
    var ratio = maxW / w;
    return { w: maxW, h: Math.round(h * ratio) };
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
