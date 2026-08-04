/* board-container.js — .kanvaz container format (v2, since 4.1.0)
   Main-process-only module (Node, no Electron APIs) — plain CommonJS,
   same pattern as pur-import.js, so it can be required directly by
   both main.js and the test suite without any Electron runtime.

   A .kanvaz file used to be plain JSON with every image/video/audio
   embedded as a base64 data URL right inside it — simple, but base64
   inflates binary data by ~33%, and a corrupt byte anywhere in one
   giant JSON string could take the whole file down with it.

   New saves are a zip container instead: `board.json` (the exact same
   shape as before) plus one `assets/<cardId>.<ext>` file per embedded
   asset, holding the raw bytes instead of a base64 string, with a
   SHA-256 hash recorded per asset for corruption detection. Old plain-
   JSON files still open exactly as before — this only changes how NEW
   saves are written, never how existing files are read.

   Deliberately isolated to this one module: the renderer's card model
   still always works with `card.dataUrl` as a data: URL exactly like
   it always has (every build*Card function, serialise/deserialise in
   cards.js, all of it — completely unchanged). Packing/unpacking only
   happens here, at the file-write/file-read boundary in main.js, so
   this is the only place a mistake could do any damage. */

var crypto = require('crypto');
var JSZip = require('jszip');

var MIME_TO_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/bmp': 'bmp', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a'
};
var EXT_TO_MIME = (function() {
  var out = {};
  for (var mime in MIME_TO_EXT) { out[MIME_TO_EXT[mime]] = mime; }
  return out;
})();

/* ZIP files always start with a "PK" local-file-header signature.
   Plain JSON (every .kanvaz file before 4.1.0) always starts with
   '{' (after optional whitespace/BOM). Cheap, reliable way to tell
   old files from new ones without trying/failing a parse first. */
function looksLikeZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B;
}

/* Pull every card's embedded dataUrl out into its own zip entry,
   replacing it with a pointer + integrity hash. Cards with no media
   (note/color/url/file/etc — dataUrl already null) pass through
   untouched. Returns a Promise<Buffer> ready to write to disk. */
function packBoard(jsonString) {
  var data = JSON.parse(jsonString);
  var zip = new JSZip();
  var assets = zip.folder('assets');

  function packList(list) {
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      (function(card) {
        if (!card.dataUrl || typeof card.dataUrl !== 'string') return;
        /* Audit fix: this whole per-card block used to have no try/catch.
           A single malformed card (unexpected dataUrl shape, corrupt
           base64, anything Buffer.from/crypto could choke on) threw
           uncaught here, aborting THIS ENTIRE FUNCTION — and therefore
           the whole board save, not just that one card's asset —
           directly contradicting this module's own design goal (see the
           file header: "this is the only place a mistake could do any
           damage", meant as damage contained to one asset, never to the
           whole save). Falls back to leaving that one card's dataUrl
           exactly as it was (embedded inline, same as a pre-4.1.0 file)
           rather than losing the save entirely. */
        try {
          var match = /^data:([^;]+);base64,([\s\S]*)$/.exec(card.dataUrl);
          if (!match) return; /* not a data URL we recognize — leave as-is */
          var mime = match[1];
          var buf = Buffer.from(match[2], 'base64');
          var ext = MIME_TO_EXT[mime] || 'bin';
          var assetName = card.id + '.' + ext;
          assets.file(assetName, buf);
          card.dataUrl   = null;
          card.assetRef  = 'assets/' + assetName;
          card.assetHash = crypto.createHash('sha256').update(buf).digest('hex');
          /* Audit fix: MIME_TO_EXT only covers Kanvaz's own built-in
             media types. A plugin-authored card's dataUrl can carry any
             MIME string (e.g. a plugin embedding image/svg+xml) — without
             this, such a card fell back to ext:'bin' here and was
             silently reconstructed as the generic application/octet-
             stream on the next load, permanently losing the real MIME
             type and breaking anything (like an <img src>) that depends
             on it. Stored as a separate field so the exact original MIME
             survives the round trip regardless of whether it's in
             MIME_TO_EXT at all. */
          card.assetMime = mime;
        } catch (e) {
          console.error('[Kanvaz] could not pack asset for card "' + (card.id || '?') + '", saving it inline instead:', e.message);
        }
      })(list[i]);
    }
  }

  if (data.boards) {
    for (var b = 0; b < data.boards.length; b++) packList(data.boards[b].cards);
  }
  data.formatVersion = 2;

  zip.file('board.json', JSON.stringify(data));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/* Reverse of packBoard — reads board.json out of the zip, re-inflates
   every assetRef back into a dataUrl so the rest of the app never has
   to know the container format exists. A hash mismatch or a missing
   asset entry doesn't throw — it just leaves dataUrl null for that one
   card, which the existing "Missing media" error state already
   handles gracefully (same UI a moved/deleted file would show). One
   damaged asset can never take down the rest of the board. */
function unpackBoard(buf) {
  return JSZip.loadAsync(buf).then(function(zip) {
    var boardEntry = zip.file('board.json');
    if (!boardEntry) throw new Error('Not a valid Kanvaz board — board.json missing from container');
    return boardEntry.async('string').then(function(jsonStr) {
      var data = JSON.parse(jsonStr);
      var pending = [];

      function unpackList(list) {
        if (!list) return;
        for (var i = 0; i < list.length; i++) {
          (function(card) {
            if (!card.assetRef) return;
            var ref  = card.assetRef;
            var hash = card.assetHash;
            /* Audit fix: prefer the exact MIME recorded at pack time
               (see packBoard() above) over guessing from the file
               extension — the extension-based EXT_TO_MIME lookup only
               covers Kanvaz's own built-in media types and is now just
               the backward-compat fallback for assets packed by an
               older Kanvaz version that didn't record assetMime yet. */
            var explicitMime = card.assetMime;
            /* Clear the container-only bookkeeping fields immediately —
               the card object handed back to the renderer should look
               exactly like it always has (dataUrl populated, nothing
               else), regardless of which branch below runs. */
            delete card.assetRef;
            delete card.assetHash;
            delete card.assetMime;
            var entry = zip.file(ref);
            if (!entry) { card.dataUrl = null; return; }
            pending.push(entry.async('nodebuffer').then(function(assetBuf) {
              if (hash) {
                var actual = crypto.createHash('sha256').update(assetBuf).digest('hex');
                if (actual !== hash) { card.dataUrl = null; return; }
              }
              var ext = ref.split('.').pop().toLowerCase();
              var mime = explicitMime || EXT_TO_MIME[ext] || 'application/octet-stream';
              card.dataUrl = 'data:' + mime + ';base64,' + assetBuf.toString('base64');
            }));
          })(list[i]);
        }
      }

      if (data.boards) {
        for (var b = 0; b < data.boards.length; b++) unpackList(data.boards[b].cards);
      }

      return Promise.all(pending).then(function() { return JSON.stringify(data); });
    });
  });
}

module.exports = {
  looksLikeZip: looksLikeZip,
  packBoard:    packBoard,
  unpackBoard:  unpackBoard
};
