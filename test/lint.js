#!/usr/bin/env node
/* ============================================================
   Kanvaz Static Linter
   Catches the specific bug classes that have bitten this project:
   - const/let/arrow/forEach (var-only rule)
   - inline onclick (CSP violation — silently dead buttons)
   - version drift across the 6 canonical locations
   - unguarded JSON.parse of external/file data
   - hardcoded dark colors that break light theme
   - stale "final release" / "no further development" language
   - TODO/FIXME/XXX left in shipping code
   Exit code 1 if any ERROR-level issue is found.
   ============================================================ */

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var ROOT = path.join(__dirname, '..');

var errors = [];
var warnings = [];

function err(file, line, msg)  { errors.push({ file: file, line: line, msg: msg }); }
function warn(file, line, msg) { warnings.push({ file: file, line: line, msg: msg }); }

function jsFiles() {
  return fs.readdirSync(SRC).filter(function(f) { return f.endsWith('.js'); });
}

function eachLine(file, cb) {
  var full = path.join(SRC, file);
  var lines = fs.readFileSync(full, 'utf8').split('\n');
  for (var i = 0; i < lines.length; i++) cb(lines[i], i + 1);
}

/* ---- 1. var-only rule ---- */
function checkVarRule() {
  jsFiles().forEach(function(file) {
    eachLine(file, function(line, n) {
      var stripped = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (/\bconst\s/.test(stripped)) err(file, n, 'uses "const" (var-only rule)');
      if (/\blet\s/.test(stripped))   err(file, n, 'uses "let" (var-only rule)');
      if (/=>/.test(stripped))        err(file, n, 'uses arrow function (var-only rule)');
      if (/\.forEach\s*\(/.test(stripped)) err(file, n, 'uses .forEach (var-only rule)');
    });
  });
}

/* ---- 2. CSP: no inline event handlers in HTML ---- */
function checkCSP() {
  var html = path.join(SRC, 'index.html');
  if (!fs.existsSync(html)) return;
  var lines = fs.readFileSync(html, 'utf8').split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (/\son(click|change|input|mouseenter|mouseleave|load)\s*=/.test(lines[i])) {
      err('index.html', i + 1, 'inline event handler — CSP will silently block it');
    }
  }
}

/* ---- 3. Version consistency ---- */
function checkVersion() {
  var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  var v = pkg.version;
  var found = { 'package.json': v };

  var boards = fs.readFileSync(path.join(SRC, 'boards.js'), 'utf8');
  var m = boards.match(/var VERSION\s*=\s*'([\d.]+)'/);
  found['boards.js'] = m ? m[1] : 'MISSING';

  var ui = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
  var m2 = ui.match(/Version ([\d.]+)/);
  found['ui.js'] = m2 ? m2[1] : 'MISSING';

  Object.keys(found).forEach(function(loc) {
    if (found[loc] !== v) {
      err(loc, 0, 'version mismatch: found "' + found[loc] + '", expected "' + v + '"');
    }
  });

  // Scan for any OTHER version-like strings that don't match (stale refs)
  jsFiles().forEach(function(file) {
    eachLine(file, function(line, n) {
      var vm = line.match(/\b3\.\d+\.\d+\b/g);
      if (vm) {
        vm.forEach(function(vs) {
          if (vs !== v && !/CHANGELOG|prior|previous|was |v3\.0|v3\.1|v3\.2|v3\.3|v3\.4/.test(line)) {
            warn(file, n, 'possible stale version "' + vs + '" (current is ' + v + ')');
          }
        });
      }
    });
  });
}

/* ---- 4. Unguarded JSON.parse of external data ---- */
function checkJsonParse() {
  jsFiles().forEach(function(file) {
    var full = path.join(SRC, file);
    var lines = fs.readFileSync(full, 'utf8').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Only care about parsing FILE/IPC data (result.data, fs.readFileSync, raw)
      if (/JSON\.parse\s*\(\s*(result\.data|raw|fs\.readFileSync)/.test(line)) {
        // Look backwards up to 3 lines for a try
        var guarded = false;
        for (var j = Math.max(0, i - 3); j <= i; j++) {
          if (/\btry\s*\{/.test(lines[j])) guarded = true;
        }
        if (!guarded) {
          warn(file, i + 1, 'JSON.parse of external data without nearby try/catch');
        }
      }
    }
  });
}

/* ---- 5. Hardcoded dark colors that break light theme ---- */
function checkHardcodedColors() {
  var darkHexes = ['#0E0E10', '#131318', '#1A1A22', '#1A1A28', '#22222C'];
  jsFiles().forEach(function(file) {
    // main.js is the Electron main process — its backgroundColor is set
    // before any CSS loads, so a hardcoded value is correct there.
    if (file === 'main.js') return;
    eachLine(file, function(line, n) {
      // Skip CSS var definitions, comments, and decorative SVG fills
      if (/--color|\/\*|\* |<rect|<circle|<path|fill="#/.test(line)) return;
      darkHexes.forEach(function(hex) {
        if (line.indexOf(hex) !== -1 && line.indexOf('var(') === -1) {
          warn(file, n, 'hardcoded dark color ' + hex + ' — use a CSS variable for theme support');
        }
      });
      if (/rgba\(0\s*,\s*0\s*,\s*0/.test(line) && /style|cssText|setAttribute/.test(line)) {
        warn(file, n, 'hardcoded black rgba in inline style — use var(--color-shadow/overlay)');
      }
    });
  });
}

/* ---- 6. Stale release language ---- */
function checkStaleLanguage() {
  ['CHANGELOG.md', 'README.md'].forEach(function(f) {
    var full = path.join(ROOT, f);
    if (!fs.existsSync(full)) return;
    var lines = fs.readFileSync(full, 'utf8').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var low = lines[i].toLowerCase();
      if (/—\s*final release|no further development|development is complete|feature-complete\b/.test(low)
          && !/removed|updated from|was /.test(low)) {
        warn(f, i + 1, 'stale "final release" language for an actively-developed app');
      }
    }
  });
}

/* ---- 7. TODO/FIXME left in code ---- */
function checkTodos() {
  jsFiles().forEach(function(file) {
    eachLine(file, function(line, n) {
      if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) {
        warn(file, n, 'leftover ' + line.match(/\b(TODO|FIXME|XXX|HACK)\b/)[0] + ' marker');
      }
    });
  });
}

/* ---- Run all ---- */
checkVarRule();
checkCSP();
checkVersion();
checkJsonParse();
checkHardcodedColors();
checkStaleLanguage();
checkTodos();

/* ---- Report ---- */
console.log('\n=== Kanvaz Static Lint ===\n');
if (errors.length === 0 && warnings.length === 0) {
  console.log('  CLEAN — no issues found.\n');
  process.exit(0);
}

if (errors.length) {
  console.log('ERRORS (' + errors.length + '):');
  errors.forEach(function(e) {
    console.log('  [ERROR] ' + e.file + (e.line ? ':' + e.line : '') + ' — ' + e.msg);
  });
  console.log('');
}
if (warnings.length) {
  console.log('WARNINGS (' + warnings.length + '):');
  warnings.forEach(function(w) {
    console.log('  [warn]  ' + w.file + (w.line ? ':' + w.line : '') + ' — ' + w.msg);
  });
  console.log('');
}

console.log('Summary: ' + errors.length + ' errors, ' + warnings.length + ' warnings.\n');
process.exit(errors.length > 0 ? 1 : 0);
