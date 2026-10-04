/* save-guard.js — decides whether saving a board would silently overwrite
   a newer save made by someone/something else.

   Why this exists: a .kanvaz file on a shared drive or NAS can be saved
   from two machines. file-write used to replace whatever was on disk with
   no check, so the later save quietly erased the earlier one. main.js now
   remembers the file's mtime when it was opened/last saved and compares it
   to the file's mtime right before the final rename.

   Both mtimes come from the same file on the same filesystem, so client
   versus server clock difference is irrelevant. The tolerance exists only
   because FAT/exFAT and some SMB/NAS stacks round mtimes to 2 seconds, and
   a write we made ourselves must never read back as someone else's.

   Node-only, no electron require, so test/save-guard-test.js can run it.
   ES5/var-only like the rest of src/. */

var fs = require('fs');

var MTIME_TOLERANCE_MS = 2000;

function isNum(n) { return typeof n === 'number' && isFinite(n); }

/* expectedMtimeMs: what the file's mtime was when we last read/wrote it
   (null/undefined = no expectation, e.g. Save As or a first save).
   diskMtimeMs: the file's mtime right now (null/undefined = file missing). */
function isConflict(expectedMtimeMs, diskMtimeMs) {
  if (!isNum(expectedMtimeMs)) return false;
  if (!isNum(diskMtimeMs)) return false;
  return Math.abs(diskMtimeMs - expectedMtimeMs) > MTIME_TOLERANCE_MS;
}

/* Stats the target and reports a conflict. Always resolves (never rejects):
   a missing file or a stat error is "no conflict" because there is nothing
   on disk to overwrite or we cannot prove one, and refusing to save over a
   stat hiccup would be worse than the risk it guards. */
function checkTarget(filePath, expectedMtimeMs) {
  if (!isNum(expectedMtimeMs)) return Promise.resolve({ conflict: false });
  return fs.promises.stat(filePath).then(function(st) {
    return { conflict: isConflict(expectedMtimeMs, st.mtimeMs), diskMtimeMs: st.mtimeMs };
  }, function() {
    return { conflict: false };
  });
}

/* Atomic write with the conflict check placed as late as possible: the
   (possibly large, slow) zip is already built by the caller, the .tmp is
   written first, and the target is stat-checked immediately before the
   rename so the race window is one stat wide, not the length of a pack.
   On conflict the .tmp is removed and the real file is left untouched.
   opts.expectedMtimeMs: mtime recorded at last read/write (omit to skip).
   opts.force: skip the check (the user chose Overwrite). */
function guardedWrite(filePath, zipBuf, opts) {
  opts = opts || {};
  var tmpPath = filePath + '.tmp';
  var cleanup = function() { try { fs.unlinkSync(tmpPath); } catch (_) {} };
  return fs.promises.writeFile(tmpPath, zipBuf)
    .then(function() {
      if (opts.force) return { conflict: false };
      return checkTarget(filePath, opts.expectedMtimeMs);
    })
    .then(function(chk) {
      if (chk.conflict) {
        cleanup();
        return { ok: false, conflict: true, diskMtimeMs: chk.diskMtimeMs };
      }
      return fs.promises.rename(tmpPath, filePath)
        .then(function() { return fs.promises.stat(filePath); })
        .then(function(st) { return { ok: true, mtimeMs: st.mtimeMs }; });
    })
    .catch(function(e) {
      cleanup();
      return { ok: false, error: e.message };
    });
}

module.exports = {
  MTIME_TOLERANCE_MS: MTIME_TOLERANCE_MS,
  isConflict: isConflict,
  checkTarget: checkTarget,
  guardedWrite: guardedWrite
};
