#!/usr/bin/env node
/* openable-types-test.js — "Open with Kanvaz" from the OS.

   Three things must agree, and this fails if they drift apart:
     1. src/openable-types.js (what main.js accepts from launch arguments),
     2. package.json build.fileAssociations (what the installers register with
        Windows / macOS), and build.linux.mimeTypes,
     3. the extensions the renderer really turns into cards (media.js lists +
        PDF + Adobe files).
   Also checks the argument filter refuses everything it should. */

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ot = require('../src/openable-types');
var pkg = require('../package.json');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-open-'));
function touch(n) { var p = path.join(TMP, n); fs.writeFileSync(p, 'x'); return p; }

function run() {
  /* 1. classification */
  ['a.PNG', 'b.jpeg', 'c.glb', 'd.FBX', 'e.usdz', 'f.blend', 'g.psd', 'h.AI', 'i.xd', 'j.mp4', 'k.wav', 'l.pdf', 'm.gif', 'n.indd'].forEach(function(n) {
    assert(ot.isOpenable(n), n + ' is openable');
  });
  ['a.kanvaz', 'a.txt', 'a.json', 'a.exe', 'a.hta', 'a.js', 'a.zip', 'a.docx', 'a', 'a.png.exe', 'README'].forEach(function(n) {
    assert(!ot.isOpenable(n), n + ' is not openable');
  });
  assert(ot.isOpenable('x.png.'), 'trailing dot (Windows) does not hide the extension');
  assert(!ot.isOpenable('x.exe.'), 'trailing dot does not smuggle an exe through');
  console.log('  ✓ 14 supported types recognised (case-insensitive); boards, text, executables and scripts are not');

  /* 2. argv filtering */
  var png = touch('pic.png'), glb = touch('model.GLB'), psd = touch('art.psd'), exe = touch('bad.exe'), txt = touch('note.txt');
  fs.mkdirSync(path.join(TMP, 'dir.png'));
  var got = ot.filesFromArgv(['C:\\Program Files\\Kanvaz\\Kanvaz.exe', '.', '--remote-debugging-port=9333', png, glb, psd, exe, txt, path.join(TMP, 'missing.png'), path.join(TMP, 'dir.png'), png, '\\\\evil\\share\\x.png', '//evil/share/y.glb', '-x.png', ''], TMP);
  assert.deepStrictEqual(got, [png, glb, psd], 'only real, local, supported files, once each, in order');
  assert.deepStrictEqual(ot.filesFromArgv(['pic.png', 'model.GLB'], TMP), [png, glb], 'relative paths resolve against the launch directory');
  assert.deepStrictEqual(ot.filesFromArgv([], TMP), [], 'no arguments');
  assert.deepStrictEqual(ot.filesFromArgv([null, 5, {}, undefined], TMP), [], 'non-strings are ignored');
  var many = [];
  for (var i = 0; i < 80; i++) many.push(touch('m' + i + '.png'));
  assert.strictEqual(ot.filesFromArgv(many, TMP).length, ot.MAX_FILES_PER_LAUNCH, 'a launch cannot add more than ' + ot.MAX_FILES_PER_LAUNCH + ' files');
  console.log('  ✓ launch arguments: flags, the app itself, folders, missing files, UNC/remote paths, executables and duplicates are all skipped; capped at ' + ot.MAX_FILES_PER_LAUNCH);

  /* 2b. alternate data streams — only exercised where they can actually be
     created (Windows); elsewhere the platform-gated check in
     filesFromArgv never runs, so there is nothing to prove. */
  if (process.platform === 'win32') {
    var adsBase = touch('ads-carrier.png');
    var adsPath = adsBase + ':payload.png';
    try { fs.writeFileSync(adsPath, 'x'); } catch (e) { /* stream creation unsupported on this filesystem */ }
    if (fs.existsSync(adsPath)) {
      assert.deepStrictEqual(ot.filesFromArgv([adsPath], TMP), [], 'a path naming an alternate data stream is refused even though its basename looks like a plain .png');
      console.log('  ✓ alternate data stream paths (file.png:stream.png) are refused, not read as an image');
    } else {
      console.log('  (skipped ADS check — this filesystem would not create the stream)');
    }
  }

  /* 2c. case-fold dedupe — a path handed to us twice with different casing
     (Windows/macOS are case-insensitive) must still be one card. Only
     meaningful where the filesystem itself is case-insensitive. */
  var pngUpper = png.toUpperCase();
  if (pngUpper !== png && fs.existsSync(pngUpper)) {
    assert.deepStrictEqual(ot.filesFromArgv([png, pngUpper], TMP), [png], 'the same file named with different casing is only added once');
    console.log('  ✓ the same path in different casing (case-insensitive filesystem) is deduplicated');
  }

  /* 3. package.json's fileAssociations registers ONLY .kanvaz. electron-builder's
     NSIS target ignores role/rank (they are documented macOS-only in its own
     FileAssociation.d.ts) and unconditionally sets Kanvaz as the Windows
     default handler for every listed extension — so every other type Kanvaz
     can preview is deliberately kept OUT of this shared list. Those are
     registered per-platform instead, in ways that cannot set a default:
     mac.extendInfo.CFBundleDocumentTypes (LSHandlerRank Alternate, a real
     macOS-only guarantee) and the generated build/installer.nsh (Windows
     OpenWithProgids only, see tools/gen-nsis-associations.js). Linux's
     AppImage MimeType= list (checked below) never sets a default either. */
  var assoc = pkg.build.fileAssociations;
  assert.strictEqual(assoc.length, 1, 'fileAssociations has only the board type — see this test\'s comment for why');
  var board = assoc[0];
  assert(board.ext === 'kanvaz' && board.role === 'Editor', 'boards stay an Editor association');

  /* macOS: CFBundleDocumentTypes, Viewer/Alternate, covers every other type */
  var cfTypes = pkg.build.mac.extendInfo.CFBundleDocumentTypes;
  var macRegistered = [];
  cfTypes.forEach(function(t) {
    macRegistered = macRegistered.concat(t.CFBundleTypeExtensions);
    assert.strictEqual(t.CFBundleTypeRole, 'Viewer', t.CFBundleTypeName + ' is registered as a viewer, not the owner of the file type');
    assert.strictEqual(t.LSHandlerRank, 'Alternate', t.CFBundleTypeName + ': rank is Alternate, so Kanvaz shows in "Open With" without taking over the default app');
  });
  macRegistered.sort(); var expected = ot.ALL.slice().sort();
  assert.deepStrictEqual(macRegistered, expected, 'mac.extendInfo.CFBundleDocumentTypes and openable-types.js list exactly the same extensions');
  assert.strictEqual(macRegistered.length, new Set(macRegistered).size, 'no extension is registered twice on mac');
  console.log('  ✓ macOS registers exactly the same ' + macRegistered.length + ' extensions via CFBundleDocumentTypes, as viewer/alternate');

  /* Windows: the generated NSIS include must be committed AND in sync with
     openable-types.js right now (this is what a stale, hand-edited, or
     forgotten-to-regenerate build/installer.nsh would fail on in CI). */
  var genNsis = require('../tools/gen-nsis-associations');
  var current = fs.readFileSync(genNsis.OUT_PATH, 'utf8');
  assert.strictEqual(current, genNsis.generate(), 'build/installer.nsh is stale — run node tools/gen-nsis-associations.js');

  /* Bug-bounty fix: this assertion used to require two literal backslashes
     ("\\\\") between path segments, but the real .nsh has one ("\") — the
     regex could never match, so this never actually tested anything (empty
     bodyContent... appending the real dangerous line and re-running still
     passed). Self-test the pattern against a deliberately reintroduced
     copy of the dangerous line first, so a future edit to the regex can't
     silently go dead the same way again. */
  var DEFAULT_HANDLER_LINE = /WriteRegStr\s+SHELL_CONTEXT\s+"Software\\Classes\\\.\$\{EXT\}"\s+""\s+"\$\{PROGID\}"/;
  var reintroduced = current + '\n  WriteRegStr SHELL_CONTEXT "Software\\Classes\\.${EXT}" "" "${PROGID}"\n';
  assert(DEFAULT_HANDLER_LINE.test(reintroduced), 'self-test: the pattern must actually catch the dangerous line when present');
  assert(!DEFAULT_HANDLER_LINE.test(current), 'the generated script must never write the extension\'s own default-handler key');

  ot.ALL.forEach(function(e) {
    assert(new RegExp('KANVAZ_OPEN_WITH "' + e + '"').test(current), 'installer.nsh registers "Open with Kanvaz" for .' + e);
  });
  console.log('  ✓ Windows: build/installer.nsh is in sync, registers every type for "Open with" only, never as the default (regex self-tested)');

  var mimes = pkg.build.linux.mimeTypes;
  Object.keys(ot.GROUPS).forEach(function(k) {
    ot.GROUPS[k].mimes.forEach(function(m) { assert(mimes.indexOf(m) !== -1, 'linux mimeTypes has ' + m); });
  });
  assert(mimes.indexOf('application/x-kanvaz') !== -1, 'boards keep their linux mime type');
  console.log('  ✓ Linux desktop entry lists every MIME type');

  /* 4. every embedded/previewed type the renderer knows about is
     registered here too (media.js lists + pdf + adobe). The reverse isn't
     required any more: 9.2.0 added a "recognized but no in-card preview"
     category (openable-types.js's zbrush/houdini/cinema4d/maya groups) —
     these are deliberately openable (a real file-type label/icon, "Open
     with Kanvaz" from the OS) while only ever becoming a generic
     file-reference card, the same as any unrecognized file already did.
     GROUPS keys that group is explicitly listed below, everything else
     must still have real card-building support in media.js. */
  var NO_PREVIEW_GROUPS = ['zbrush', 'houdini', 'cinema4d', 'maya', 'clip', 'procreate'];
  var media = fs.readFileSync(path.join(__dirname, '..', 'src', 'media.js'), 'utf8');
  function list(name) { var m = new RegExp('var ' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(media); return m[1].split(',').map(function(x) { return x.replace(/['\s]/g, ''); }).filter(Boolean); }
  var cardTypes = list('IMAGE_EXTS').concat(list('GIF_EXTS'), list('VIDEO_EXTS'), list('AUDIO_EXTS'), list('MODEL_EXTS'), ['blend', 'pdf', 'psd', 'psb', 'ai', 'xd', 'indd', 'indt', 'hdr', 'pic', 'exr', 'kra']);
  cardTypes.forEach(function(e) { assert(ot.ALL.indexOf(e) !== -1, e + ' becomes a card but is missing from openable-types.js'); });
  var previewableAll = [];
  Object.keys(ot.GROUPS).forEach(function(g) {
    if (NO_PREVIEW_GROUPS.indexOf(g) === -1) previewableAll = previewableAll.concat(ot.GROUPS[g].exts);
  });
  previewableAll.forEach(function(e) { assert(cardTypes.indexOf(e) !== -1, e + ' is registered with the OS but Kanvaz cannot make a card from it'); });
  NO_PREVIEW_GROUPS.forEach(function(g) {
    assert(ot.GROUPS[g], 'GROUPS has the "' + g + '" no-preview group');
    ot.GROUPS[g].exts.forEach(function(e) { assert(cardTypes.indexOf(e) === -1, e + ' has real preview support now — move it out of the no-preview list'); });
  });
  console.log('  ✓ every type with real card/preview support is registered with the OS; the labeled-but-no-preview formats (' + NO_PREVIEW_GROUPS.join(', ') + ') are openable and correctly excluded from that check');
}

try { run(); fs.rmSync(TMP, { recursive: true, force: true }); console.log('ALL OPENABLE TYPES TESTS PASSED'); }
catch (e) { console.log('OPENABLE TYPES TEST FAILED'); console.log(e && e.stack || e); process.exit(1); }
