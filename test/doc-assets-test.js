#!/usr/bin/env node
/* ============================================================
   Kanvaz — doc/installer asset test
   Usage: node test/doc-assets-test.js
   Guards two bugs found 2026-10-04:
     1. docs/index.html's favicon pointed at assets/icon.png, a file that
        does not exist (so the landing page had no favicon).
     2. assets/installer-sidebar.bmp (the Windows Setup wizard art) was an
        old design that never got updated when the logo changed.
   Image CONTENT cannot be judged here; this checks that every asset
   reference resolves and that the installer art is structurally valid.
   ============================================================ */

var fs = require('fs');
var path = require('path');
var assert = require('assert');

var ROOT = path.join(__dirname, '..');
function p() { return path.join.apply(null, [ROOT].concat([].slice.call(arguments))); }

function run() {
  /* ── 1. every asset referenced by README / landing page / guide exists ── */
  var files = ['README.md', 'docs/index.html'].concat(
    fs.readdirSync(p('docs', 'guide')).filter(function(f) { return /\.md$/.test(f); }).map(function(f) { return 'docs/guide/' + f; })
  );
  var problems = [];
  files.forEach(function(f) {
    var txt = fs.readFileSync(p(f), 'utf8');
    var re = /(?:src|href|content)="([^"]+)"|\]\(([^)\s]+)\)/g;
    var m;
    while ((m = re.exec(txt)) !== null) {
      var ref = m[1] || m[2];
      if (!ref || /^(#|mailto:|data:|javascript:)/.test(ref)) continue;
      var rel = null;
      var gh = ref.match(/github\.com\/p4inz-code\/kanvaz\/(?:blob|raw|tree)\/main\/([^?#]+)/) ||
               ref.match(/raw\.githubusercontent\.com\/p4inz-code\/kanvaz\/main\/([^?#]+)/);
      if (gh) rel = gh[1];
      else if (/^https?:/.test(ref)) continue;
      else {
        var clean = ref.split('#')[0].split('?')[0];
        if (!clean) continue;
        rel = path.posix.normalize(path.posix.join(path.posix.dirname(f), clean));
      }
      if (!/\.(png|jpe?g|gif|svg|ico|bmp|webp|mp4|webm|md|html|pdf)$/i.test(rel)) continue;
      if (!fs.existsSync(p(rel))) problems.push(f + ' -> ' + ref + ' (missing: ' + rel + ')');
    }
  });
  assert.deepStrictEqual(problems, [], 'broken asset references:\n  ' + problems.join('\n  '));
  console.log('  ✓ every image/link target referenced by README, landing page and ' + (files.length - 2) + ' guide pages exists');

  /* ── 2. installer + icon files named in package.json exist and are valid ── */
  var build = JSON.parse(fs.readFileSync(p('package.json'), 'utf8')).build;
  var named = [build.win && build.win.icon, build.mac && build.mac.icon, build.linux && build.linux.icon,
    build.nsis && build.nsis.installerIcon, build.nsis && build.nsis.uninstallerIcon,
    build.nsis && build.nsis.installerSidebar, build.nsis && build.nsis.uninstallerSidebar].filter(Boolean);
  named.forEach(function(rel) {
    var exists = fs.existsSync(p(rel)) || fs.existsSync(p(rel + '.ico')) || fs.existsSync(p(rel + '.icns')) || fs.existsSync(p(rel + '.png'));
    assert.ok(exists, 'package.json names ' + rel + ' but no such file exists');
  });
  console.log('  ✓ every icon / installer image named in package.json exists (' + named.length + ' references)');

  var bmp = fs.readFileSync(p(build.nsis.installerSidebar));
  assert.strictEqual(bmp.toString('ascii', 0, 2), 'BM', 'installer sidebar must be a BMP');
  var w = bmp.readInt32LE(18), h = Math.abs(bmp.readInt32LE(22)), bpp = bmp.readUInt16LE(28), comp = bmp.readUInt32LE(30);
  assert.strictEqual(w, 164, 'NSIS welcome-page art must be 164 px wide, got ' + w);
  assert.strictEqual(h, 314, 'NSIS welcome-page art must be 314 px tall, got ' + h);
  assert.strictEqual(bpp, 24, 'NSIS needs a 24-bit BMP (no alpha), got ' + bpp + '-bit');
  assert.strictEqual(comp, 0, 'NSIS needs an uncompressed BMP');
  assert.strictEqual(build.nsis.installerSidebar, build.nsis.uninstallerSidebar, 'installer and uninstaller sidebars should match');
  console.log('  ✓ installer sidebar is a valid NSIS image (164x314, 24-bit, uncompressed)');

  /* ── 3a. the handout PDF's version pill matches package.json (regenerate it on release) ── */
  var ver = JSON.parse(fs.readFileSync(p('package.json'), 'utf8')).version;
  var pdf = fs.readFileSync(p('docs', 'Kanvaz_Overview.pdf')).toString('latin1');
  assert.ok(pdf.indexOf('(v' + ver + ')') !== -1, 'docs/Kanvaz_Overview.pdf does not show v' + ver + ' (run: python docs/generate_overview_pdf.py)');
  console.log('  ✓ docs/Kanvaz_Overview.pdf shows the current version (v' + ver + ')');

  /* ── 3b. the landing page's "Source Modules" stat equals the real src/*.js count ── */
  var realModules = fs.readdirSync(p('src')).filter(function(f) { return /\.js$/.test(f); }).length;
  var landing = fs.readFileSync(p('docs', 'index.html'), 'utf8');
  var mm = landing.match(/stat-value">(\d+)<\/div>\s*<div class="stat-label">Source Modules/);
  assert.ok(mm, 'could not find the Source Modules stat on docs/index.html');
  assert.strictEqual(Number(mm[1]), realModules, 'docs/index.html says ' + mm[1] + ' source modules but src/ has ' + realModules);
  console.log('  ✓ landing page Source Modules stat (' + mm[1] + ') equals the real src/*.js count');

  /* ── 3. the ICO carries every standard size (Windows picks by context) ── */
  var ico = fs.readFileSync(p('assets', 'icons', 'icon.ico'));
  var count = ico.readUInt16LE(4), sizes = [];
  for (var i = 0; i < count; i++) { var s = ico[6 + i * 16]; sizes.push(s === 0 ? 256 : s); }
  [16, 32, 48, 256].forEach(function(want) { assert.ok(sizes.indexOf(want) !== -1, 'icon.ico is missing the ' + want + 'px image'); });
  console.log('  ✓ icon.ico contains 16/32/48/256 px images (has: ' + sizes.sort(function(a, b) { return a - b; }).join(', ') + ')');
}

try {
  run();
  console.log('\n  ALL DOC ASSET TESTS PASSED');
} catch (e) {
  console.error('\n  FAIL:', e && e.message || e);
  process.exit(1);
}
