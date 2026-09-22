#!/usr/bin/env node
/* gen-nsis-associations.js — generates build/installer.nsh from
   src/openable-types.js, the one list openable-types.js's own header
   comment already says three things must never disagree about; this is
   the fourth.

   Why this exists at all: electron-builder's package.json `fileAssociations`
   array feeds Windows NSIS, macOS Info.plist and (indirectly) the reasoning
   for Linux all from ONE shared list, but only .kanvaz should ever become
   the OS *default* handler for its extension. On macOS, `role`/`rank` are
   real per-type fields (LSHandlerRank "Alternate" genuinely keeps Kanvaz out
   of the default slot) — but per app-builder-lib's own FileAssociation.d.ts,
   both are documented "macOS-only". On Windows, electron-builder's NSIS
   target ignores them entirely: every fileAssociations entry, regardless of
   role, gets `WriteRegStr SHELL_CONTEXT "Software\Classes\.ext" "" FILECLASS`
   — i.e. it always takes over the extension's default handler. Kanvaz listing
   .png/.jpg/.mp4/.mp3/.pdf/etc. there would silently steal the Windows
   default for Photos/VLC/Acrobat/whatever the user already had, on every
   install — not what "Viewer, Alternate" was supposed to mean.

   The fix: those extensions are NOT in package.json's build.fileAssociations
   (see package.json — only .kanvaz, an Editor association, is there; macOS's
   non-default "Open with" media types come from build.mac.extendInfo's own
   CFBundleDocumentTypes instead, independent of this file). This script
   generates the Windows-only equivalent as a custom NSIS include
   (nsis.include in package.json): it registers a ProgID and adds Kanvaz to
   `OpenWithProgids` for each extension (so "Open with > Kanvaz" works from
   Explorer) but never writes the extension's own default-handler key.

   Run: node tools/gen-nsis-associations.js
   Registered in package.json's build:win/build:all/dist scripts, and
   test/openable-types-test.js fails if the committed file is stale. */

var fs = require('fs');
var path = require('path');
var openable = require('../src/openable-types');

var OUT_PATH = path.join(__dirname, '..', 'build', 'installer.nsh');

/* One ProgID per group, e.g. "Kanvaz.Image" — matches the grouping
   openable-types.js already uses for names shown in the OS UI. */
function progId(groupKey) {
  return 'Kanvaz.' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1);
}

function nsisEscape(s) {
  return String(s).replace(/\$/g, '$$$$').replace(/"/g, '$\\"');
}

function generate() {
  var lines = [];
  lines.push('; Kanvaz — Windows "Open with" registration, generated file, do not hand-edit.');
  lines.push('; Regenerate with: node tools/gen-nsis-associations.js');
  lines.push('; Source of truth: src/openable-types.js (see that file\'s and this script\'s own');
  lines.push('; header comments for why this exists as a separate, default-handler-safe path).');
  lines.push('');
  lines.push('!macro KANVAZ_OPEN_WITH EXT PROGID DESCRIPTION');
  lines.push('  WriteRegStr SHELL_CONTEXT "Software\\Classes\\${PROGID}" "" "${DESCRIPTION}"');
  lines.push('  WriteRegStr SHELL_CONTEXT "Software\\Classes\\${PROGID}\\DefaultIcon" "" "$appExe,0"');
  lines.push('  WriteRegStr SHELL_CONTEXT "Software\\Classes\\${PROGID}\\shell\\open\\command" "" \'"$appExe" "%1"\'');
  lines.push('  WriteRegNone SHELL_CONTEXT "Software\\Classes\\.${EXT}\\OpenWithProgids" "${PROGID}"');
  lines.push('!macroend');
  lines.push('');
  lines.push('!macro KANVAZ_OPEN_WITH_REMOVE EXT PROGID');
  lines.push('  DeleteRegKey SHELL_CONTEXT "Software\\Classes\\${PROGID}"');
  lines.push('  DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.${EXT}\\OpenWithProgids" "${PROGID}"');
  lines.push('!macroend');
  lines.push('');

  var groupKeys = Object.keys(openable.GROUPS).sort();   /* stable order -> stable diffs */
  var installLines = ['!macro customInstall'];
  var uninstallLines = ['!macro customUnInstall'];
  for (var gi = 0; gi < groupKeys.length; gi++) {
    var key = groupKeys[gi];
    var group = openable.GROUPS[key];
    var id = progId(key);
    var desc = nsisEscape(group.name + ' (opens as a card on a Kanvaz board)');
    var exts = group.exts.slice().sort();
    for (var ei = 0; ei < exts.length; ei++) {
      installLines.push('  !insertmacro KANVAZ_OPEN_WITH "' + exts[ei] + '" "' + id + '" "' + desc + '"');
      uninstallLines.push('  !insertmacro KANVAZ_OPEN_WITH_REMOVE "' + exts[ei] + '" "' + id + '"');
    }
  }
  installLines.push('!macroend');
  uninstallLines.push('!macroend');

  lines = lines.concat(installLines, [''], uninstallLines, ['']);
  return lines.join('\n');
}

function main() {
  var content = generate();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, content);
  console.log('wrote ' + OUT_PATH);
}

if (require.main === module) {
  main();
} else {
  module.exports = { generate: generate, OUT_PATH: OUT_PATH, progId: progId };
}
