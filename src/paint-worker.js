/* paint-worker.js — runs paint-preview.previewFile() on a worker thread.
   Same isolation as adobe-worker.js/hdr-worker.js: a huge or hostile file
   (or a maliciously crafted zip with many entries/high compression ratio)
   can only stall its own request, never the main process. */
'use strict';
var wt = require('worker_threads');
var paintPreview = require('./paint-preview');

paintPreview.previewFile(wt.workerData.filePath, { maxFileBytes: wt.workerData.maxFileBytes }).then(function(r) {
  wt.parentPort.postMessage(r);
}, function(e) {
  wt.parentPort.postMessage({ ok: false, reason: String(e && e.message || e) });
});
