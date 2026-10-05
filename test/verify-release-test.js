#!/usr/bin/env node
/* ============================================================
   Kanvaz — tools/verify-release.js test
   Usage: node test/verify-release-test.js
   Builds a synthetic "good" asset directory, proves the verifier accepts it
   and the REAL download guide, then reproduces each historical release bug
   and proves the verifier rejects it. No network.
   ============================================================ */

var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var assert = require('assert');
var vr = require(path.join(__dirname, '..', 'tools', 'verify-release.js'));

var VERSION = '9.9.9';
var PLUGINS = ['ai-export', 'mcp-bridge', 'template-maker', 'theme-creator'];
var GUIDE = fs.readFileSync(path.join(__dirname, '..', '.github', 'release-download-guide.md'), 'utf8');
var made = [];

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function makeGood() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanvaz-verify-rel-'));
  made.push(dir);
  var files = {};
  vr.requiredAssets(VERSION, PLUGINS).forEach(function(n) { files[n] = Buffer.from('content of ' + n); });
  Object.keys(files).forEach(function(n) { fs.writeFileSync(path.join(dir, n), files[n]); });
  function sums(names) {
    return names.map(function(n) { return sha(files[n]) + '  ' + n; }).join('\n') + '\n';
  }
  fs.writeFileSync(path.join(dir, 'SHA256SUMS-windows-latest.txt'), sums(['Kanvaz-Setup-' + VERSION + '.exe', 'Kanvaz-' + VERSION + '.exe']));
  fs.writeFileSync(path.join(dir, 'SHA256SUMS-macos-latest.txt'), sums(['Kanvaz-' + VERSION + '-arm64.dmg', 'Kanvaz-' + VERSION + '.dmg']));
  fs.writeFileSync(path.join(dir, 'SHA256SUMS-ubuntu-latest.txt'), sums(['Kanvaz-' + VERSION + '.AppImage']));
  return { dir: dir, files: files, sums: sums };
}

function run(dir, extra) {
  var o = { dir: dir, version: VERSION, pluginDirs: PLUGINS, guideText: GUIDE, releases: null };
  Object.keys(extra || {}).forEach(function(k) { o[k] = extra[k]; });
  return vr.verify(o);
}

function expectError(errors, re, label) {
  assert.ok(errors.some(function(e) { return re.test(e); }), label + ' — got: ' + JSON.stringify(errors));
}

async function main() {
  /* ── helpers ── */
  var names = vr.guideAssetNames(GUIDE, VERSION);
  assert.ok(names.indexOf('Kanvaz-Setup-' + VERSION + '.exe') !== -1, 'guide parser finds the Windows installer');
  assert.ok(names.indexOf('Kanvaz-' + VERSION + '-arm64.dmg') !== -1);
  assert.ok(names.indexOf('latest-linux.yml') !== -1);
  assert.ok(!names.some(function(n) { return /[*\s]/.test(n); }), 'wildcards and commands are never treated as file names');
  assert.ok(!names.some(function(n) { return /x64/.test(n); }), 'the "-x64" aside is prose, not a file name');
  console.log('  ✓ guide parser reads real file names and skips wildcards/commands/prose (' + names.length + ' names)');

  var parsed = vr.parseSums(sha(Buffer.from('a')) + '  Kanvaz-1.exe\n' + sha(Buffer.from('b')) + ' *Kanvaz-2.dmg\njunk line\n');
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[1].name, 'Kanvaz-2.dmg');
  console.log('  ✓ checksum parser handles both sha256sum text and binary-mode lines');

  /* ── the good set passes (this also runs the REAL guide against the set) ── */
  var g = makeGood();
  var errs = await run(g.dir);
  assert.deepStrictEqual(errs, [], 'a correct release must pass cleanly, got ' + JSON.stringify(errs));
  console.log('  ✓ a correct release (and the real download guide) passes');

  /* ── v7.14-v7.21: installers silently missing ── */
  g = makeGood();
  fs.unlinkSync(path.join(g.dir, 'Kanvaz-' + VERSION + '.AppImage'));
  errs = await run(g.dir);
  expectError(errs, /missing asset: Kanvaz-9\.9\.9\.AppImage/, 'missing installer');
  console.log('  ✓ a missing installer is caught (the 8-releases-with-no-installers bug)');

  /* ── 9.7.0: checksum file names a space-named file nobody can download ── */
  g = makeGood();
  var bad = fs.readFileSync(path.join(g.dir, 'SHA256SUMS-windows-latest.txt'), 'utf8').replace('Kanvaz-Setup-' + VERSION + '.exe', 'Kanvaz Setup ' + VERSION + '.exe');
  fs.writeFileSync(path.join(g.dir, 'SHA256SUMS-windows-latest.txt'), bad);
  errs = await run(g.dir);
  expectError(errs, /lists "Kanvaz Setup 9\.9\.9\.exe" which is not an uploaded asset/, 'space-named checksum');
  expectError(errs, /no checksum line.*Kanvaz-Setup-9\.9\.9\.exe/, 'installer left uncovered');
  console.log('  ✓ checksum names that do not match real assets are caught (the 9.7.0 bug)');

  /* ── corrupted / tampered upload ── */
  g = makeGood();
  fs.writeFileSync(path.join(g.dir, 'Kanvaz-' + VERSION + '.dmg'), 'tampered');
  errs = await run(g.dir);
  expectError(errs, /hash mismatch for Kanvaz-9\.9\.9\.dmg/, 'hash mismatch');
  console.log('  ✓ a hash mismatch is caught');

  /* ── truncated upload ── */
  g = makeGood();
  fs.writeFileSync(path.join(g.dir, 'Kanvaz-Setup-' + VERSION + '.exe'), '');
  errs = await run(g.dir);
  expectError(errs, /zero bytes: Kanvaz-Setup-9\.9\.9\.exe/, 'zero byte');
  console.log('  ✓ a zero-byte installer is caught');

  /* ── 9.7.0: the guide named a file that does not exist (Intel dmg with -x64) ── */
  g = makeGood();
  var wrongGuide = GUIDE.replace('`Kanvaz-<version>.dmg`', '`Kanvaz-<version>-x64.dmg`');
  assert.notStrictEqual(wrongGuide, GUIDE, 'test setup: the guide must contain the Intel dmg row');
  errs = await run(g.dir, { guideText: wrongGuide });
  expectError(errs, /download guide names "Kanvaz-9\.9\.9-x64\.dmg"/, 'wrong guide file name');
  console.log('  ✓ a download-guide filename with no matching asset is caught (the 9.7.0 bug)');

  /* ── missing plugin zip ── */
  g = makeGood();
  fs.unlinkSync(path.join(g.dir, 'kanvaz-ai-export-' + VERSION + '.zip'));
  errs = await run(g.dir);
  expectError(errs, /missing asset: kanvaz-ai-export-9\.9\.9\.zip/, 'missing plugin zip');
  console.log('  ✓ a missing official-plugin zip is caught');

  /* ── v9.6.0: two drafts for one tag, one untagged ── */
  g = makeGood();
  errs = await run(g.dir, { releases: [{ tagName: 'v9.9.9', isDraft: true }, { tagName: 'v9.9.9', isDraft: true }], tag: 'v9.9.9' });
  expectError(errs, /2 releases share the tag v9\.9\.9/, 'duplicate release');
  errs = await run(g.dir, { releases: [{ tagName: 'v9.9.9', isDraft: true }, { tagName: 'untagged-abc123', isDraft: true }], tag: 'v9.9.9' });
  expectError(errs, /stray untagged draft/, 'untagged draft');
  errs = await run(g.dir, { releases: [{ tagName: 'v9.9.9', isDraft: true }, { tagName: 'v9.8.0', isDraft: false }], tag: 'v9.9.9' });
  assert.deepStrictEqual(errs, [], 'one draft for the tag plus older published releases is fine');
  errs = await run(g.dir, { releases: [{ tagName: 'v9.8.0', isDraft: false }], tag: 'v9.9.9' });
  expectError(errs, /no release found for tag v9\.9\.9/, 'no release for tag');
  console.log('  ✓ duplicate / untagged / absent draft releases are caught; a single draft passes');

  /* ── official-plugin catalog drift (warnings, never failures) ── */
  var JSZip = require('jszip');
  var cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanvaz-verify-cat-'));
  made.push(cdir);
  async function putZip(name, manifest) {
    var z = new JSZip();
    if (manifest) z.file('plugin.json', JSON.stringify(manifest));
    fs.writeFileSync(path.join(cdir, 'kanvaz-' + name + '-' + VERSION + '.zip'), await z.generateAsync({ type: 'nodebuffer' }));
  }
  await putZip('theme-creator', { id: 'x.theme', name: 'Theme Creator', version: '1.1.0', permissions: [] });
  await putZip('ai-export', { id: 'x.ai', name: 'AI Export', version: '1.0.0', permissions: [] });
  await putZip('mcp-bridge', { id: 'x.mcp', name: 'MCP Bridge', version: '1.5.0', permissions: ['server'] });
  await putZip('template-maker', null);
  var cat = [
    { id: 'x.theme', version: '1.0.0', permissions: [] },
    { id: 'x.mcp', version: '1.5.0', permissions: [] }
  ];
  var w = await vr.catalogWarnings(cdir, cat, VERSION, ['theme-creator', 'ai-export', 'mcp-bridge', 'template-maker', 'not-built']);
  assert.ok(w.some(function(m) { return m.indexOf('Theme Creator: catalog says 1.0.0 but this release ships 1.1.0') !== -1 && m.indexOf('download/v9.9.9/kanvaz-theme-creator-9.9.9.zip') !== -1; }), 'stale version warns with the exact URL to use: ' + JSON.stringify(w));
  assert.ok(w.some(function(m) { return m.indexOf('AI Export 1.0.0 has no entry') !== -1; }), 'unlisted plugin warns');
  assert.ok(w.some(function(m) { return m.indexOf('MCP Bridge: catalog permissions [] differ') !== -1; }), 'permission mismatch warns');
  assert.ok(w.some(function(m) { return m.indexOf('no plugin.json at its root') !== -1; }), 'zip without root plugin.json warns');
  assert.strictEqual(w.length, 4, 'a plugin with no zip in the draft is skipped, not reported: ' + JSON.stringify(w));
  var okCat = [
    { id: 'x.theme', version: '1.1.0', permissions: [] },
    { id: 'x.ai', version: '1.0.0', permissions: [] },
    { id: 'x.mcp', version: '1.5.0', permissions: ['server'] }
  ];
  w = await vr.catalogWarnings(cdir, okCat, VERSION, ['theme-creator', 'ai-export', 'mcp-bridge']);
  assert.deepStrictEqual(w, [], 'an up-to-date catalog produces no warnings');
  console.log('  ✓ catalog drift (stale version, unlisted plugin, wrong permissions) is flagged with the exact fix; an up-to-date catalog is silent');

  /* a corrupt zip must degrade to a warning, never reject (review finding on 9.8.0) */
  var bad = fs.mkdtempSync(path.join(os.tmpdir(), 'kanvaz-verify-bad-'));
  made.push(bad);
  fs.writeFileSync(path.join(bad, 'kanvaz-ai-export-' + VERSION + '.zip'), 'this is not a zip');
  var wb = await vr.catalogWarnings(bad, [], VERSION, ['ai-export']);
  assert.strictEqual(wb.length, 1, 'one warning, no rejection: ' + JSON.stringify(wb));
  assert.ok(wb[0].indexOf('could not be checked against the catalog') !== -1, wb[0]);
  console.log('  ✓ a corrupt plugin zip becomes a warning instead of crashing the run');
}

main().then(function() {
  made.forEach(function(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
  console.log('\n  ALL VERIFY RELEASE TESTS PASSED');
}).catch(function(e) {
  made.forEach(function(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (x) { /* best effort */ } });
  console.error('\n  FAIL:', e && e.stack || e);
  process.exit(1);
});
