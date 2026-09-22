/* hdr-worker.js — runs hdr-preview.previewFile() on a worker thread.
   main.js starts one per request and kills it if it takes too long, same
   pattern as adobe-worker.js — a huge or hostile HDR/EXR file can stall
   only its own preview, never the app. previewFile() is synchronous (no
   async I/O beyond the one readFileSync it already does internally) and
   never throws (it catches its own errors into {ok:false, reason}), so
   there is no separate error path to wire up here. */
'use strict';
var wt = require('worker_threads');
var hdrPreview = require('./hdr-preview');

wt.parentPort.postMessage(hdrPreview.previewFile(wt.workerData.filePath, { maxSide: wt.workerData.maxSide }));
