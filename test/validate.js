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

/* 5. Version consistency */
section('5. Version consistency');
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
