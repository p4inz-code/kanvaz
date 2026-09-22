/* Pure helpers for the "Check for updates" flow — kept separate from
   main.js (which requires 'electron' and so can't be loaded by a plain
   Node test) so the platform logic and error wording can be unit tested
   directly. See main.js's auto-updater section for how these are used,
   and app.js for the renderer side. */
var KanvazAutoUpdateSupport = (function() {
  'use strict';

  /* electron-updater's real download-and-install path only works when
     the running build is something it can actually replace in place:
       - Windows NSIS (installed, not portable) — works unsigned.
       - Linux AppImage — works unsigned (checksum-verified, no codesign
         requirement).
       - macOS — Squirrel.Mac REQUIRES a valid code signature to replace
         the running app bundle. Kanvaz ships unsigned on mac (no Apple
         Developer ID; see .github/workflows/build.yml), so calling
         checkForUpdates() there either errors with a confusing codesign
         message or silently can't finish — worse than just being honest
         upfront. Same story for the portable .exe: there's no installed
         copy for quitAndInstall() to replace.
     Both cases fall back to the same fast, reliable path: compare
     versions and hand the user the release page — see 'update-unsupported'
     in app.js. */
  function supportFor(platform, isPortable) {
    if (platform === 'win32' && isPortable) return { ok: false, reason: 'portable' };
    if (platform === 'darwin') return { ok: false, reason: 'mac-unsigned' };
    return { ok: true, reason: null };
  }

  /* electron-updater's own error messages are technically accurate but
     read like a stack trace ("HttpError: 404 ..."); turn the common
     ones into the same plain wording the old manual GitHub check used,
     so the user sees one consistent voice regardless of which path
     produced the message. */
  function friendlyError(err) {
    var msg = (err && err.message) || String(err || 'Unknown error');
    if (/\b404\b/.test(msg)) return "Couldn't find a release on GitHub";
    if (/\b403\b/.test(msg)) return 'GitHub rate-limited this check — try again in a few minutes';
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(msg)) {
      return "Couldn't check — no internet, or GitHub unreachable";
    }
    return "Couldn't check for updates: " + msg;
  }

  return { supportFor: supportFor, friendlyError: friendlyError };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = KanvazAutoUpdateSupport;
