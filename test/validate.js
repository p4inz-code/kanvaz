#!/usr/bin/env node
/* ============================================================
   Kanvaz — Full Validation Suite
   Runs every check in sequence. Exit 1 if anything fails.
   Usage: node test/validate.js
   ============================================================ */

var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SRC = path.join(ROOT, 'src');
var pass = true;

function section(name) { console.log('\n\u2501\u2501\u2501 ' + name + ' \u2501\u2501\u2501'); }
function ok(msg)  { console.log('  \u2713 ' + msg); }
function bad(msg) { console.log('  \u2717 ' + msg); pass = false; }

/* 1. Syntax check every JS file */
section('1. Syntax (node --check)');
var jsFiles = fs.readdirSync(SRC).filter(function(f){ return f.endsWith('.js'); });
var syntaxFail = 0;
jsFiles.forEach(function(f) {
  try {
    cp.execSync('node --check "' + path.join(SRC, f) + '"', { stdio: 'pipe' });
  } catch (e) {
    bad(f + ' — ' + e.message.split('\n')[0]);
    syntaxFail++;
  }
});
if (syntaxFail === 0) ok('all ' + jsFiles.length + ' files parse');

/* 2. Static lint */
section('2. Static lint');
try {
  var lintOut = cp.execSync('node "' + path.join(__dirname, 'lint.js') + '"', { encoding: 'utf8' });
  if (/CLEAN/.test(lintOut)) ok('no lint issues');
  else if (/0 errors/.test(lintOut)) ok('0 errors (warnings acceptable)');
  else { bad('lint reported errors'); console.log(lintOut); }
} catch (e) {
  bad('lint FAILED');
  console.log(e.stdout || e.message);
}

/* 3. Port alignment (real browser) — only if a Chrome/Chromium binary can be found.
   Never hardcode one path/version — that silently breaks on every other machine. */
section('3. Port alignment (real Chromium)');
if (fs.existsSync(path.join(__dirname, 'run-port-test.js'))) {
  try {
    var portOut = cp.execSync('node "' + path.join(__dirname, 'run-port-test.js') + '"', { encoding: 'utf8', timeout: 60000 });
    if (/ALL CASES PASS/.test(portOut)) ok('formula matches DOM, 0px error at all zoom/pan');
    else if (/^SKIP/m.test(portOut)) console.log('  ' + portOut.trim().split('\n').join('\n  '));
    else { bad('port alignment test failed'); console.log(portOut); }
  } catch (e) {
    bad('port alignment test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/run-port-test.js missing)');
}

/* 4. .kanvaz container format round trip */
section('4. Board container format round trip');
if (fs.existsSync(path.join(__dirname, 'format-roundtrip-test.js'))) {
  try {
    var formatOut = cp.execSync('node "' + path.join(__dirname, 'format-roundtrip-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL FORMAT ROUND-TRIP TESTS PASSED/.test(formatOut)) ok('pack/unpack lossless, old files still detected, corruption handled safely');
    else { bad('format round-trip test failed'); console.log(formatOut); }
  } catch (e) {
    bad('format round-trip test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/format-roundtrip-test.js missing)');
}

/* 5. Plugin loader — manifest validation, permission escalation, path safety */
section('5. Plugin loader');
if (fs.existsSync(path.join(__dirname, 'plugin-loader-test.js'))) {
  try {
    var pluginOut = cp.execSync('node "' + path.join(__dirname, 'plugin-loader-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL PLUGIN LOADER TESTS PASSED/.test(pluginOut)) ok('manifest validation, permission escalation, and path-traversal guard all correct');
    else { bad('plugin loader test failed'); console.log(pluginOut); }
  } catch (e) {
    bad('plugin loader test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/plugin-loader-test.js missing)');
}

/* 5b. SSRF guard — URL-card preview must never reach private/loopback addresses */
section('5b. SSRF guard (URL preview fetch)');
if (fs.existsSync(path.join(__dirname, 'net-guard-test.js'))) {
  try {
    var guardOut = cp.execSync('node "' + path.join(__dirname, 'net-guard-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL NET GUARD TESTS PASSED/.test(guardOut)) ok('private/loopback/link-local/reserved addresses blocked, public allowed, real loopback request refused');
    else { bad('net guard test failed'); console.log(guardOut); }
  } catch (e) {
    bad('net guard test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/net-guard-test.js missing)');
}

/* 5d. Path guard — file IPC scope, UNC/NTLM refusal, open-path blocklist */
section('5d. Path guard (file IPC trust boundary)');
if (fs.existsSync(path.join(__dirname, 'path-guard-test.js'))) {
  try {
    var pgOut = cp.execSync('node "' + path.join(__dirname, 'path-guard-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL PATH GUARD TESTS PASSED/.test(pgOut)) ok('remote/UNC refused, board paths need .kanvaz + a main-issued grant, widened launcher blocklist');
    else { bad('path guard test failed'); console.log(pgOut); }
  } catch (e) {
    bad('path guard test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/path-guard-test.js missing)');
}

/* 5d2. Save guard — shared-drive overwrite detection */
section('5d2. Save guard (shared-drive overwrite)');
if (fs.existsSync(path.join(__dirname, 'save-guard-test.js'))) {
  try {
    var sgOut = cp.execSync('node "' + path.join(__dirname, 'save-guard-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL SAVE GUARD TESTS PASSED/.test(sgOut)) ok('foreign saves detected, own saves and 2 s mtime rounding are not, force and deleted-target paths behave');
    else { bad('save guard test failed'); console.log(sgOut); }
  } catch (e) {
    bad('save guard test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/save-guard-test.js missing)');
}

/* 5d3. Release-asset verifier — the tool CI runs against every draft release */
section('5d3. Release-asset verifier');
if (fs.existsSync(path.join(__dirname, 'verify-release-test.js'))) {
  try {
    var vrOut = cp.execSync('node "' + path.join(__dirname, 'verify-release-test.js') + '"', { encoding: 'utf8', timeout: 60000 });
    if (/ALL VERIFY RELEASE TESTS PASSED/.test(vrOut)) ok('catches missing installers, bad checksum names, hash mismatch, wrong guide filenames, duplicate drafts; accepts a correct release');
    else { bad('verify-release test failed'); console.log(vrOut); }
  } catch (e) {
    bad('verify-release test crashed');
    console.log(e.stdout || e.message);
  }
  var buildYml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8');
  if (/verify-release:/.test(buildYml) && /tools\/verify-release\.js/.test(buildYml)) ok('build.yml still runs tools/verify-release.js against the draft');
  else bad('build.yml no longer has the verify-release job — release assets are unchecked again');
} else {
  console.log('  (skipped — test/verify-release-test.js missing)');
}

/* 5d4. Doc + installer assets: broken references, installer art validity */
section('5d4. Doc and installer assets');
if (fs.existsSync(path.join(__dirname, 'doc-assets-test.js'))) {
  try {
    var daOut = cp.execSync('node "' + path.join(__dirname, 'doc-assets-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL DOC ASSET TESTS PASSED/.test(daOut)) ok('no broken asset references in README/landing/guide; installer sidebar and icon files valid');
    else { bad('doc assets test failed'); console.log(daOut); }
  } catch (e) {
    bad('doc assets test failed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/doc-assets-test.js missing)');
}

/* 5d5. Always-on-top vs other topmost apps (ZBrush) */
section('5d5. Keep on top');
if (fs.existsSync(path.join(__dirname, 'keep-on-top-test.js'))) {
  try {
    var kotOut = cp.execSync('node "' + path.join(__dirname, 'keep-on-top-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL KEEP-ON-TOP TESTS PASSED/.test(kotOut)) ok('re-raises above other topmost apps without taking focus; stops when off; macOS full-screen level');
    else { bad('keep-on-top test failed'); console.log(kotOut); }
  } catch (e) {
    bad('keep-on-top test failed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/keep-on-top-test.js missing)');
}

/* 5d6. Remembered MoodLock window position */
section('5d6. Window bounds');
if (fs.existsSync(path.join(__dirname, 'window-bounds-test.js'))) {
  try {
    var wbOut = cp.execSync('node "' + path.join(__dirname, 'window-bounds-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL WINDOW BOUNDS TESTS PASSED/.test(wbOut)) ok('a remembered window position is only restored if it is still reachable on a connected display');
    else { bad('window bounds test failed'); console.log(wbOut); }
  } catch (e) {
    bad('window bounds test failed');
    console.log(e.stdout || e.message);
  }
}

/* 5e. MCP bridge token auth */
section('5e. MCP token auth');
if (fs.existsSync(path.join(__dirname, 'mcp-auth-test.js'))) {
  try {
    var maOut = cp.execSync('node "' + path.join(__dirname, 'mcp-auth-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL MCP AUTH TESTS PASSED/.test(maOut)) ok('256-bit per-start token, constant-time verify, atomic token file, removed on stop');
    else { bad('mcp auth test failed'); console.log(maOut); }
  } catch (e) {
    bad('mcp auth test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/mcp-auth-test.js missing)');
}

/* 5f. Board container decompression limits */
section('5f. Board container limits (zip-bomb defense)');
if (fs.existsSync(path.join(__dirname, 'board-container-limits-test.js'))) {
  try {
    var bcOut = cp.execSync('node "' + path.join(__dirname, 'board-container-limits-test.js') + '"', { encoding: 'utf8', timeout: 60000 });
    if (/ALL BOARD CONTAINER LIMIT TESTS PASSED/.test(bcOut)) ok('oversized board.json/asset/total/entry-count rejected before inflating; normal board unchanged');
    else { bad('board container limits test failed'); console.log(bcOut); }
  } catch (e) {
    bad('board container limits test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/board-container-limits-test.js missing)');
}

/* 5g. Local crash log */
section('5g. Crash log (local only)');
if (fs.existsSync(path.join(__dirname, 'crash-log-test.js'))) {
  try {
    var clOut = cp.execSync('node "' + path.join(__dirname, 'crash-log-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL CRASH LOG TESTS PASSED/.test(clOut)) ok('JSON lines, home dir masked, fields clipped, rotates at 1 MB, never throws');
    else { bad('crash log test failed'); console.log(clOut); }
  } catch (e) {
    bad('crash log test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/crash-log-test.js missing)');
}

/* 5c. Blender detection — finds installs on any drive/version */
section('5c. Blender detection');
if (fs.existsSync(path.join(__dirname, 'blender-detect-test.js'))) {
  try {
    var bdOut = cp.execSync('node "' + path.join(__dirname, 'blender-detect-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL BLENDER DETECT TESTS PASSED/.test(bdOut)) ok('newest-version pick, plain/other-drive folders, PATH, override, registry parser, null when absent');
    else { bad('blender detect test failed'); console.log(bdOut); }
  } catch (e) {
    bad('blender detect test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/blender-detect-test.js missing)');
}

/* 5h. Kanvaz Link listener — token, consent, whitelist, caps, real pipe */
section('5h. Kanvaz Link listener');
if (fs.existsSync(path.join(__dirname, 'link-server-test.js'))) {
  try {
    var lkOut = cp.execSync('node "' + path.join(__dirname, 'link-server-test.js') + '"', { encoding: 'utf8', timeout: 120000 });
    if (/ALL LINK SERVER TESTS PASSED/.test(lkOut)) ok('token on every request, four-method whitelist, consent gating, hostile input refused, real pipe/socket');
    else { bad('link server test failed'); console.log(lkOut); }
  } catch (e) {
    bad('link server test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/link-server-test.js missing)');
}

/* 5i. Kanvaz Link controller — consent, drop dir, queue, delivery, off switch */
section('5i. Kanvaz Link controller');
if (fs.existsSync(path.join(__dirname, 'link-controller-test.js'))) {
  try {
    var lcOut = cp.execSync('node "' + path.join(__dirname, 'link-controller-test.js') + '"', { encoding: 'utf8', timeout: 120000 });
    if (/ALL LINK CONTROLLER TESTS PASSED/.test(lcOut)) ok('native-consent flow, private drop dir, delivery to the renderer, hostile files refused, off switch');
    else { bad('link controller test failed'); console.log(lcOut); }
  } catch (e) {
    bad('link controller test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/link-controller-test.js missing)');
}

/* 5j. Adobe previews — PSD/PSB composite, XD, XMP thumbnails, AI, Fresco */
section('5j. Adobe previews');
if (fs.existsSync(path.join(__dirname, 'adobe-preview-test.js'))) {
  try {
    var adOut = cp.execSync('node "' + path.join(__dirname, 'adobe-preview-test.js') + '"', { encoding: 'utf8', timeout: 120000 });
    if (/ALL ADOBE PREVIEW TESTS PASSED/.test(adOut)) ok('PSD/PSB (raw+RLE, 8/16-bit, RGB/gray/indexed/CMYK, alpha), XD, XMP thumbnails, AI, Fresco; broken files refused');
    else { bad('adobe preview test failed'); console.log(adOut); }
  } catch (e) {
    bad('adobe preview test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/adobe-preview-test.js missing)');
}

/* 5k. Open with Kanvaz — launch-argument filter, and that package.json registers exactly the supported types */
section('5k. Open with Kanvaz (OS integration)');
if (fs.existsSync(path.join(__dirname, 'openable-types-test.js'))) {
  try {
    var otOut = cp.execSync('node "' + path.join(__dirname, 'openable-types-test.js') + '"', { encoding: 'utf8', timeout: 60000 });
    if (/ALL OPENABLE TYPES TESTS PASSED/.test(otOut)) ok('argv filter safe; package.json fileAssociations + Linux MIME types match the supported types exactly');
    else { bad('openable types test failed'); console.log(otOut); }
  } catch (e) {
    bad('openable types test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/openable-types-test.js missing)');
}

/* 5f. Blender export script — hidden objects / extra scenes excluded, alpha kept (real Blender if installed) */
section('5f. Blender export script');
if (fs.existsSync(path.join(__dirname, 'blender-export-test.js'))) {
  try {
    var beOut = cp.execSync('node "' + path.join(__dirname, 'blender-export-test.js') + '"', { encoding: 'utf8', timeout: 240000 });
    if (/ALL BLENDER EXPORT TESTS PASSED/.test(beOut)) ok(/skipped/.test(beOut) ? 'script text checked (no Blender here, real-export part skipped)' : 'real Blender: hidden object and other scenes left out, alpha kept');
    else { bad('blender export test failed'); console.log(beOut); }
  } catch (e) {
    bad('blender export test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/blender-export-test.js missing)');
}

/* 5g. 3D render modes — colour/opacity/sidedness survive every mode (real Three.js) */
section('5g. 3D render modes');
if (fs.existsSync(path.join(__dirname, 'model3d-modes-test.js'))) {
  try {
    var mmOut = cp.execSync('node "' + path.join(__dirname, 'model3d-modes-test.js') + '"', { encoding: 'utf8', timeout: 60000 });
    if (/ALL MODEL3D MODES TESTS PASSED/.test(mmOut)) ok('Shaded/Normals/Matcap/Wireframe/Albedo/Alpha keep colour, opacity and sidedness; original materials untouched');
    else { bad('model3d modes test failed'); console.log(mmOut); }
  } catch (e) {
    bad('model3d modes test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/model3d-modes-test.js missing)');
}

/* 5l. Platform labels — Mac/Linux/Windows shortcut wording and modifier keys */
section('5l. Platform labels (Mac/Linux shortcut wording)');
if (fs.existsSync(path.join(__dirname, 'platform-test.js'))) {
  try {
    var plOut = cp.execSync('node "' + path.join(__dirname, 'platform-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL PLATFORM TESTS PASSED/.test(plOut)) ok('Apple modifier glyphs on mac, Ctrl elsewhere; mac window flags correct');
    else { bad('platform test failed'); console.log(plOut); }
  } catch (e) {
    bad('platform test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/platform-test.js missing)');
}

/* 5m. Auto-update support — platform rules (Windows/Linux real update, portable/mac fall back) and error wording */
section('5m. Auto-update support (Check for updates flow)');
if (fs.existsSync(path.join(__dirname, 'auto-update-support-test.js'))) {
  try {
    var auOut = cp.execSync('node "' + path.join(__dirname, 'auto-update-support-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL AUTO-UPDATE SUPPORT TESTS PASSED/.test(auOut)) ok('installed Windows + Linux get the real check; portable/mac fall back to the release page; error text is plain-language');
    else { bad('auto-update support test failed'); console.log(auOut); }
  } catch (e) {
    bad('auto-update support test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/auto-update-support-test.js missing)');
}

/* 5n. Preview quality — Low/Medium/High numbers shared by main.js (Adobe worker), cards.js (3D/PDF) and Properties */
section('5n. Preview quality (Low/Medium/High)');
if (fs.existsSync(path.join(__dirname, 'preview-quality-test.js'))) {
  try {
    var pqOut = cp.execSync('node "' + path.join(__dirname, 'preview-quality-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL PREVIEW QUALITY TESTS PASSED/.test(pqOut)) ok('resolve() prefers a card override over the global setting; pixel-ratio/DPI/maxSide climb low->high consistently');
    else { bad('preview quality test failed'); console.log(pqOut); }
  } catch (e) {
    bad('preview quality test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/preview-quality-test.js missing)');
}

/* 5o. HDR/EXR previews — Radiance RGBE and OpenEXR (NONE/RLE) decoding, tone-mapping, downscale */
section('5o. HDR/EXR previews');
if (fs.existsSync(path.join(__dirname, 'hdr-preview-test.js'))) {
  try {
    var hdrOut = cp.execSync('node "' + path.join(__dirname, 'hdr-preview-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL HDR\/EXR PREVIEW TESTS PASSED/.test(hdrOut)) ok('real spec-built HDR (RLE) and EXR (NONE + RLE) files round-trip correctly; unsupported EXR compression and malformed files are refused with a clear reason; tone-mapping and downscale stay in range');
    else { bad('hdr/exr preview test failed'); console.log(hdrOut); }
  } catch (e) {
    bad('hdr/exr preview test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/hdr-preview-test.js missing)');
}

/* 5p. Krita (.kra) previews — real preview.png/mergedimage.png extraction from the zip container */
section('5p. Krita previews');
if (fs.existsSync(path.join(__dirname, 'paint-preview-test.js'))) {
  try {
    var krOut = cp.execSync('node "' + path.join(__dirname, 'paint-preview-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL PAINT PREVIEW TESTS PASSED/.test(krOut)) ok('finds the real whole-canvas preview in a spec-built .kra zip, not a per-layer thumbnail or a smaller decoy; honest failure for a file with none');
    else { bad('paint preview test failed'); console.log(krOut); }
  } catch (e) {
    bad('paint preview test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/paint-preview-test.js missing)');
}

/* 6. Command registry — registration validation, palette filtering, fuzzy match */
section('6. Command registry');
if (fs.existsSync(path.join(__dirname, 'command-registry-test.js'))) {
  try {
    var cmdOut = cp.execSync('node "' + path.join(__dirname, 'command-registry-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL COMMAND REGISTRY TESTS PASSED/.test(cmdOut)) ok('registerCommand validation, palette filtering, and fuzzy match all correct');
    else { bad('command registry test failed'); console.log(cmdOut); }
  } catch (e) {
    bad('command registry test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/command-registry-test.js missing)');
}

/* 7. MCP Bridge end-to-end (real MCP protocol, both ends) */
section('7. MCP Bridge end-to-end');
if (fs.existsSync(path.join(__dirname, 'mcp-bridge-e2e-test.mjs'))) {
  try {
    var mcpOut = cp.execSync('node "' + path.join(__dirname, 'mcp-bridge-e2e-test.mjs') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL MCP BRIDGE E2E TESTS PASSED/.test(mcpOut)) ok('real MCP client <-> server.js <-> fake Kanvaz round trip all correct');
    else if (/^SKIP/m.test(mcpOut)) console.log('  ' + mcpOut.trim().split('\n').join('\n  '));
    else { bad('MCP Bridge e2e test failed'); console.log(mcpOut); }
  } catch (e) {
    bad('MCP Bridge e2e test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/mcp-bridge-e2e-test.mjs missing)');
}

/* 8. Plugin permission scoping (real browser) */
section('8. Plugin permission scoping');
if (fs.existsSync(path.join(__dirname, 'plugin-scope-test.js'))) {
  try {
    var scopeOut = cp.execSync('node "' + path.join(__dirname, 'plugin-scope-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL PLUGIN SCOPE TESTS PASSED/.test(scopeOut)) ok('gated namespaces are correctly scoped per plugin, resting global is never left mis-scoped');
    else if (/^SKIP/m.test(scopeOut)) console.log('  ' + scopeOut.trim().split('\n').join('\n  '));
    else { bad('plugin scope test failed'); console.log(scopeOut); }
  } catch (e) {
    bad('plugin scope test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/plugin-scope-test.js missing)');
}

/* 8b. Undo history aliasing */
section('8b. Undo history snapshot integrity');
if (fs.existsSync(path.join(__dirname, 'history-alias-test.js'))) {
  try {
    var histOut = cp.execSync('node "' + path.join(__dirname, 'history-alias-test.js') + '"', { encoding: 'utf8', timeout: 15000 });
    if (/ALL HISTORY ALIAS TESTS PASSED/.test(histOut)) ok('restore() never lets a live edit alias back into a stored snapshot');
    else { bad('history alias test failed'); console.log(histOut); }
  } catch (e) {
    bad('history alias test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/history-alias-test.js missing)');
}

/* 9. PureRef .pur import (correctness, O(n) scaling, worker boundary) */
section('9. PureRef .pur import');
if (fs.existsSync(path.join(__dirname, 'pur-import-test.js'))) {
  try {
    var purOut = cp.execSync('node "' + path.join(__dirname, 'pur-import-test.js') + '"', { encoding: 'utf8', timeout: 30000 });
    if (/ALL PUR-IMPORT TESTS PASSED/.test(purOut)) ok('parses correctly, scales O(n) not O(n²), worker boundary round-trips');
    else { bad('pur-import test failed'); console.log(purOut); }
  } catch (e) {
    bad('pur-import test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/pur-import-test.js missing)');
}

/* 9b. Smart Search (lemmatized/fuzzy matching, real worker boundary) */
section('9b. Smart Search');
if (fs.existsSync(path.join(__dirname, 'smart-search-test.js'))) {
  try {
    var smartOut = cp.execSync('node "' + path.join(__dirname, 'smart-search-test.js') + '"', { encoding: 'utf8', timeout: 15000 });
    if (/ALL SMART SEARCH TESTS PASSED/.test(smartOut)) ok('lemmatized matching, ranking, and re-index all correct against the real worker');
    else { bad('smart-search test failed'); console.log(smartOut); }
  } catch (e) {
    bad('smart-search test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/smart-search-test.js missing)');
}

/* 9c. Shared cards across boards (registry round-trip, pruning) */
section('9c. Shared cards across boards');
if (fs.existsSync(path.join(__dirname, 'shared-cards-test.js'))) {
  try {
    var sharedOut = cp.execSync('node "' + path.join(__dirname, 'shared-cards-test.js') + '"', { encoding: 'utf8', timeout: 15000 });
    if (/ALL SHARED CARDS TESTS PASSED/.test(sharedOut)) ok('content registry round-trips across boards, positions stay independent, pruning works');
    else { bad('shared-cards test failed'); console.log(sharedOut); }
  } catch (e) {
    bad('shared-cards test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/shared-cards-test.js missing)');
}

/* 9d. Task Tracker (v1) — add/remove, subtask gating, 5-subtask cap, progress, card link, serialise round trip */
section('9d. Task Tracker');
if (fs.existsSync(path.join(__dirname, 'task-tracker-test.js'))) {
  try {
    var taskOut = cp.execSync('node "' + path.join(__dirname, 'task-tracker-test.js') + '"', { encoding: 'utf8', timeout: 15000 });
    if (/ALL TASK TRACKER TESTS PASSED/.test(taskOut)) ok('add/remove task+subtask, done gating only-when-subtasks-exist, 5-subtask cap on both addSubtask and load, progress aggregation, card link, malformed-file tolerance');
    else { bad('task tracker test failed'); console.log(taskOut); }
  } catch (e) {
    bad('task tracker test crashed');
    console.log(e.stdout || e.message);
  }
} else {
  console.log('  (skipped — test/task-tracker-test.js missing)');
}

/* 9f. Save-guard wiring — static guard (main.js/boards.js are not loadable
   outside Electron/DOM, so the unit test above covers the logic and this
   only guards that the wiring is not quietly removed). */
section('9f. Save guard wiring');
(function() {
  var mainSrc = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  var preloadSrc = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8');
  var boardsSrc2 = fs.readFileSync(path.join(SRC, 'boards.js'), 'utf8');
  if (/saveGuard\.guardedWrite\(/.test(mainSrc)) ok('main.js file-write goes through saveGuard.guardedWrite');
  else bad('main.js file-write no longer uses saveGuard.guardedWrite — shared-drive overwrite guard is gone');
  if (/mtimeMs: st\.mtimeMs/.test(mainSrc)) ok('main.js file-read still returns mtimeMs');
  else bad('main.js file-read no longer returns mtimeMs — renderer cannot detect conflicts');
  if (/ipcRenderer\.invoke\('file-write', p, d, opts\)/.test(preloadSrc)) ok('preload forwards the opts argument to file-write');
  else bad('preload no longer forwards file-write opts');
  if (/expectedMtimeMs: expectedMtime/.test(boardsSrc2) && /result\.conflict/.test(boardsSrc2)) ok('boards.js sends expectedMtimeMs and handles result.conflict');
  else bad('boards.js no longer sends expectedMtimeMs / handles conflicts');
})();

/* 9g. MoodLock + keep-on-top wiring: static guards (these modules are DOM/Electron-coupled) */
section('9g. MoodLock and keep-on-top wiring');
(function() {
  var mainSrc3 = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  var appSrc = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  var cardsSrc = fs.readFileSync(path.join(SRC, 'cards.js'), 'utf8');
  var scSrc = fs.readFileSync(path.join(SRC, 'shortcuts.js'), 'utf8');
  var cssSrc = fs.readFileSync(path.join(SRC, 'main.css'), 'utf8');
  if (/keepOnTop\.set\(/.test(mainSrc3) && /mainWindow\.on\('blur'/.test(mainSrc3) && !/mainWindow\.setAlwaysOnTop\(flag\)/.test(mainSrc3)) ok('main.js sets always-on-top through keep-on-top and re-raises on blur');
  else bad('main.js no longer routes always-on-top through keep-on-top (the ZBrush bug is back)');
  if (/toggleMoodLock:\s+toggleMoodLock/.test(appSrc) && /isMoodLockActive:\s+isMoodLockActive/.test(appSrc)) ok('app.js exports toggleMoodLock / isMoodLockActive');
  else bad('app.js lost the MoodLock exports');
  var guards = (cardsSrc.match(/isMoodLockActive/g) || []).length;
  if (guards >= 2) ok('cards.js keeps both read-only choke points aware of MoodLock (' + guards + ' references)');
  else bad('cards.js no longer blocks card edits while MoodLock is on');
  if (/ctrl && shift && keyLower === 'l'/.test(scSrc) && /isMoodLockActive/.test(scSrc)) ok('shortcuts.js has Ctrl+Shift+L and the MoodLock key allowlist');
  else bad('shortcuts.js lost MoodLock handling');
  var idxSrc = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  if (idxSrc.indexOf('id="btn-moodlock"') > 0 && idxSrc.indexOf('id="btn-moodlock"') < idxSrc.indexOf('id="btn-minimize"') && /on\('btn-moodlock',\s+function\(\) \{ toggleMoodLock\(\); \}\)/.test(appSrc)) ok('titlebar has the MoodLock button right before Minimize, wired to toggleMoodLock');
  else bad('the titlebar MoodLock button is missing or not wired');
  var preloadSrc3 = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8');
  if (/window-moodlock-window/.test(mainSrc3) && /window-moodlock-window/.test(preloadSrc3) && /setMoodLockWindow\(true\)/.test(appSrc) && /setMoodLockWindow\(false\)/.test(appSrc)) ok('MoodLock saves/restores the window position through main.js (enter and exit)');
  else bad('MoodLock window remember/restore wiring is incomplete');
  if (/function isolateOnly\(/.test(cardsSrc) && /moodLockStep:\s+moodLockStep/.test(appSrc) && /moodLockStep\(e\.key === 'ArrowRight'/.test(scSrc)) ok('Left/Right step through references while MoodLock is on');
  else bad('MoodLock card stepping wiring is incomplete');
  if (/body\.mood-lock-active #top-chrome[\s\S]*?body\.mood-lock-active #side-panel[\s\S]*?body\.mood-lock-active #statusbar/.test(cssSrc)) ok('main.css hides titlebar/toolbar, side panel and status bar under .mood-lock-active');
  else bad('main.css no longer hides all chrome for MoodLock');
})();

/* 10. Version consistency */
section('9e. switchBoard async contract');
/* Regression guard for a real bug (see CHANGELOG 9.7.0): switchBoard()
   used to defer its real work via setTimeout but return before that
   fired, so callers that did switchBoard(id).then(...) got a
   TypeError instead of correct sequencing. Nothing else in this suite
   exercises boards.js directly (it's DOM-coupled, no isolated harness
   exists for it), so this is a deliberately narrow static check
   rather than a full functional test — it only guards against the
   exact regression shape (a future edit quietly making either
   function synchronous again), not against every possible board-
   switch bug. */
var boardsSrc = fs.readFileSync(path.join(SRC, 'boards.js'), 'utf8');
var switchBoardBody = (function() {
  var m = boardsSrc.match(/function switchBoard\(idx\) \{([\s\S]*?)\n  \}\n/);
  return m ? m[1] : '';
})();
var switchBoardByIdBody = (function() {
  var m = boardsSrc.match(/function switchBoardById\(id\) \{([\s\S]*?)\n  \}\n/);
  return m ? m[1] : '';
})();
if (!switchBoardBody || !switchBoardByIdBody) {
  bad('could not locate switchBoard/switchBoardById in boards.js — check the regex above still matches');
} else {
  var switchBoardReturnsPromise = /return new Promise\(/.test(switchBoardBody) && /return Promise\.resolve\(/.test(switchBoardBody);
  var switchBoardByIdChainsPromise = /return switchBoard\([^)]*\)\.then\(/.test(switchBoardByIdBody);
  if (switchBoardReturnsPromise) ok('switchBoard() still returns a real Promise on every path');
  else bad('switchBoard() no longer returns a Promise on every path — this is the exact 9.7.0 regression shape');
  if (switchBoardByIdChainsPromise) ok('switchBoardById() still chains onto switchBoard()\'s Promise instead of returning a bare object');
  else bad('switchBoardById() no longer chains onto switchBoard() — callers using .then() will break again');
}

section('10. Version consistency');
var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
var v = pkg.version;
var boards = fs.readFileSync(path.join(SRC, 'boards.js'), 'utf8');
var ui = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
var readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
var checks = [
  ['boards.js VERSION', new RegExp("var VERSION\\s*=\\s*'" + v.replace(/\./g,'\\.') + "'").test(boards)],
  /* ui.js's About screen reads the version dynamically off
     KanvazBoards.getVersion() (fixed a real bug: it used to hardcode
     the string 3 separate times, independent of the real version
     constant — see CHANGELOG 7.12.0) rather than embedding it as a
     literal string, so there's no "Version X.Y.Z" substring to search
     for any more. Check that the dynamic read is still wired up
     instead. */
  ['ui.js About',       /appVersion\s*=\s*.*KanvazBoards\.getVersion/.test(ui) && ui.indexOf('v\' + appVersion') !== -1],
  ['README build cmd',  readme.indexOf(v) !== -1]
];
checks.forEach(function(c) { c[1] ? ok(c[0] + ' = ' + v) : bad(c[0] + ' != ' + v); });

/* Summary */
console.log('\n' + '\u2501'.repeat(40));
if (pass) console.log('  ALL CHECKS PASSED \u2014 ship it.');
else      console.log('  SOME CHECKS FAILED \u2014 do not ship.');
console.log('\u2501'.repeat(40) + '\n');
process.exit(pass ? 0 : 1);
