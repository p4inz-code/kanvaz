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

/* 10. Version consistency */
section('10. Version consistency');
var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
var v = pkg.version;
var boards = fs.readFileSync(path.join(SRC, 'boards.js'), 'utf8');
var ui = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
var readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
var checks = [
  ['boards.js VERSION', new RegExp("var VERSION\\s*=\\s*'" + v.replace(/\./g,'\\.') + "'").test(boards)],
  ['ui.js About',       ui.indexOf('Version ' + v) !== -1],
  ['README build cmd',  readme.indexOf(v) !== -1]
];
checks.forEach(function(c) { c[1] ? ok(c[0] + ' = ' + v) : bad(c[0] + ' != ' + v); });

/* Summary */
console.log('\n' + '\u2501'.repeat(40));
if (pass) console.log('  ALL CHECKS PASSED \u2014 ship it.');
else      console.log('  SOME CHECKS FAILED \u2014 do not ship.');
console.log('\u2501'.repeat(40) + '\n');
process.exit(pass ? 0 : 1);
