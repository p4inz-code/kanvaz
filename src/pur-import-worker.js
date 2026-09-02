/* pur-import-worker.js — runs parsePurFile() off the main thread.

   pur-import.js's parser is pure Buffer/CPU work with zero Electron
   dependencies, so it drops straight into a worker_thread. Without this,
   parsing ran directly inside main.js's 'pur-import' IPC handler — on
   Electron's main process, which also owns the native window's message
   pump, so any nontrivial .pur file (real PureRef boards routinely have
   hundreds of embedded images) blocked the ENTIRE app, not just the
   import, showing as "(Not Responding)" in the OS title bar. */

var parentPort = require('worker_threads').parentPort;
var purImport = require('./pur-import');

parentPort.once('message', function(data) {
  try {
    /* postMessage structured-clones a Node Buffer down to a plain
       Uint8Array on the receiving side — it does NOT arrive as a real
       Buffer. pur-import.js's PurReader calls Buffer-only methods
       (readDoubleBE, readUInt32BE, slice returning a Buffer, ...) that
       don't exist on a bare Uint8Array, so this re-wrap is required,
       not defensive — confirmed by testing the round trip directly
       before this fix ("r.buf.readDoubleBE is not a function"). Zero-
       copy: wraps the same underlying memory, doesn't duplicate it. */
    var buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    var parsed = purImport.parsePurFile(buffer);
    parentPort.postMessage({ ok: true, images: parsed.images, count: parsed.count });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e.message });
  }
});
