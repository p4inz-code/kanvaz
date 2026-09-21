/* crash-log.js — local-only crash/error log.

   Kanvaz never uploads anything, so when it crashes for a user there was no
   trace at all: a render-process crash just closed the window. This writes one
   line of JSON per event to crash.log in Kanvaz's own data folder, so a user
   (or a support request they choose to send) has something concrete to attach.
   Nothing here touches the network. The log rotates at 1 MB (one previous
   generation kept) so it can never grow without bound, and every string is
   length-limited. Home-directory paths are masked so a log the user chooses to
   share does not carry their OS username.

   Node-only, no electron require, so test/crash-log-test.js can run it.
   ES5/var-only like the rest of src/. */

var fs = require('fs');
var path = require('path');
var os = require('os');

var LOG_NAME = 'crash.log';
var MAX_BYTES = 1024 * 1024;
var MAX_FIELD = 4000;

function maskHome(text, home) {
  if (!home || typeof text !== 'string') return text;
  var out = text.split(home).join('~');
  /* also the other-slash form, since Windows stacks print both */
  var alt = home.indexOf('\\') !== -1 ? home.split('\\').join('/') : home.split('/').join('\\');
  return out.split(alt).join('~');
}

function clip(v, home) {
  if (v === undefined || v === null) return v;
  var s = String(v);
  if (s.length > MAX_FIELD) s = s.slice(0, MAX_FIELD) + '…[truncated]';
  return maskHome(s, home);
}

/* entry: { kind, message, stack, detail }. Never throws: a failing logger must
   not become a second crash. Returns true if written. */
function appendCrash(dir, entry, opts) {
  opts = opts || {};
  try {
    var home = opts.home !== undefined ? opts.home : os.homedir();
    var file = path.join(dir, LOG_NAME);
    try {
      if (fs.statSync(file).size > MAX_BYTES) {
        try { fs.unlinkSync(file + '.1'); } catch (e) { /* none yet */ }
        fs.renameSync(file, file + '.1');
      }
    } catch (e) { /* no log yet */ }
    var line = JSON.stringify({
      time: new Date().toISOString(),
      kind: clip(entry && entry.kind, home),
      message: clip(entry && entry.message, home),
      stack: clip(entry && entry.stack, home),
      detail: clip(entry && entry.detail, home),
      version: clip(opts.version, home),
      platform: process.platform
    });
    fs.appendFileSync(file, line + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { LOG_NAME: LOG_NAME, MAX_BYTES: MAX_BYTES, appendCrash: appendCrash, maskHome: maskHome };
