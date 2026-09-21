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

  /* 3. package.json associations cover exactly these types */
  var assoc = pkg.build.fileAssociations;
  var board = assoc.filter(function(a) { return a.ext === 'kanvaz'; })[0];
  assert(board && board.role === 'Editor', 'boards stay an Editor association');
  var registered = [];
  assoc.forEach(function(a) {
    if (a.ext === 'kanvaz') return;
    var list = Array.isArray(a.ext) ? a.ext : [a.ext];
    registered = registered.concat(list);
    assert.strictEqual(a.role, 'Viewer', a.name + ' is registered as a viewer, not the owner of the file type');
    assert.strictEqual(a.rank, 'Alternate', a.name + ': macOS rank is Alternate, so Kanvaz shows in "Open With" without taking over the default app');
    assert(a.name && a.description && a.icon, a.name + ' has a name, description and icon');
  });
  registered.sort(); var expected = ot.ALL.slice().sort();
  assert.deepStrictEqual(registered, expected, 'package.json fileAssociations and openable-types.js list exactly the same extensions');
  assert.strictEqual(registered.length, new Set(registered).size, 'no extension is registered twice');
  console.log('  ✓ package.json registers exactly the same ' + registered.length + ' extensions, as viewer/alternate (Kanvaz is offered, never forced as default)');

  var mimes = pkg.build.linux.mimeTypes;
  Object.keys(ot.GROUPS).forEach(function(k) {
    ot.GROUPS[k].mimes.forEach(function(m) { assert(mimes.indexOf(m) !== -1, 'linux mimeTypes has ' + m); });
  });
  assert(mimes.indexOf('application/x-kanvaz') !== -1, 'boards keep their linux mime type');
  console.log('  ✓ Linux desktop entry lists every MIME type');

  /* 4. the renderer really makes cards from every one of these (media.js lists + pdf + adobe) */
  var media = fs.readFileSync(path.join(__dirname, '..', 'src', 'media.js'), 'utf8');
  function list(name) { var m = new RegExp('var ' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(media); return m[1].split(',').map(function(x) { return x.replace(/['\s]/g, ''); }).filter(Boolean); }
  var cardTypes = list('IMAGE_EXTS').concat(list('GIF_EXTS'), list('VIDEO_EXTS'), list('AUDIO_EXTS'), list('MODEL_EXTS'), ['blend', 'pdf', 'psd', 'psb', 'ai', 'xd', 'indd', 'indt']);
  cardTypes.forEach(function(e) { assert(ot.ALL.indexOf(e) !== -1, e + ' becomes a card but is missing from openable-types.js'); });
  ot.ALL.forEach(function(e) { assert(cardTypes.indexOf(e) !== -1, e + ' is registered with the OS but Kanvaz cannot make a card from it'); });
  console.log('  ✓ every registered type is one the app can turn into a card, and vice versa');
}

try { run(); fs.rmSync(TMP, { recursive: true, force: true }); console.log('ALL OPENABLE TYPES TESTS PASSED'); }
catch (e) { console.log('OPENABLE TYPES TEST FAILED'); console.log(e && e.stack || e); process.exit(1); }
