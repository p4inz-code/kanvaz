/* adobe-worker.js — runs adobe-preview.previewFile() on a worker thread.
   main.js starts one per request and kills it if it takes too long, so a huge
   or hostile file can stall only its own preview, never the app. */
'use strict';
var wt = require('worker_threads');
var ap = require('./adobe-preview');

ap.previewFile(wt.workerData.filePath, { maxSide: wt.workerData.maxSide }).then(function(r) {
  wt.parentPort.postMessage(r);
}, function(e) {
  wt.parentPort.postMessage({ ok: false, reason: String(e && e.message || e) });
});
