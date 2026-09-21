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

/* 10. Version consistency */
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
